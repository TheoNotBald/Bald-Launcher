package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class SafeWalk extends Module {

    private static final double[][] EDGE_OFFSETS = {
            { 0.0, 0.0 }, { 1.0, 0.0 }, { -1.0, 0.0 }, { 0.0, 1.0 }, { 0.0, -1.0 },
            { 1.0, 1.0 }, { 1.0, -1.0 }, { -1.0, 1.0 }, { -1.0, -1.0 }
    };

    // Sneak input is sampled one tick after the key state changes, so the
    // default margin has to cover a full sprint step or SafeWalk reaches the
    // edge before crouching starts.
    private final Setting edgeMargin = setting(Setting.decimal("Edge margin", 0.45, 0.1, 0.6));
    private final Setting includeDiagonalEdges = setting(Setting.bool("Check diagonal edges", true));
    private Object forcedKey;
    private boolean forcedKeyInjected;
    private boolean forcedKeyWasPressed;

    public SafeWalk() {
        super("SafeWalk", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        if (!isAvailable()) {
            releaseForcedSneak();
            return;
        }
        Object player = Reflect.player();
        if (player == null) {
            releaseForcedSneak();
            return;
        }
        if (!Worlds.onGround(player)) {
            releaseForcedSneak();
            return;
        }
        Object world = Reflect.world();
        if (world == null) {
            return;
        }
        double x = Reflect.posX();
        double y = Reflect.posY();
        double z = Reflect.posZ();
        double margin = edgeMargin.getDouble();
        boolean nearEdge = false;
        int offsetCount = includeDiagonalEdges.getBool() ? EDGE_OFFSETS.length : 5;
        for (int index = 0; index < offsetCount; index++) {
            double[] offset = EDGE_OFFSETS[index];
            double offsetX = offset[0] == 0.0 ? 0.0 : Math.copySign(margin, offset[0]);
            double offsetZ = offset[1] == 0.0 ? 0.0 : Math.copySign(margin, offset[1]);
            if (!solid(world, x + offsetX, y - 1.0, z + offsetZ)) {
                nearEdge = true;
                break;
            }
        }
        if (nearEdge) {
            forceSneak();
        } else {
            releaseForcedSneak();
        }
    }

    @Override
    protected void onDisable() {
        releaseForcedSneak();
    }

    @Override
    protected void onUnavailable() {
        releaseForcedSneak();
    }

    private void forceSneak() {
        if (forcedKeyInjected) {
            return;
        }
        Object mc = Reflect.instance();
        Object options = mc == null ? null : Reflect.getField(mc, "options");
        Object key = options == null ? null : Reflect.getFieldAny(options, "keyShift", "sneakKey");
        if (key == null) {
            throw new IllegalStateException("Could not resolve the sneak key binding");
        }
        Object pressed = Reflect.call(key, "isPressed");
        if (!(pressed instanceof Boolean)) {
            pressed = Reflect.call(key, "isDown");
        }
        forcedKeyWasPressed = Boolean.TRUE.equals(pressed);
        if (forcedKeyWasPressed) {
            return;
        }
        if (!Reflect.invoke(key, "setPressed", true)
                && !Reflect.setField(key, "isDown", true)) {
            throw new IllegalStateException("Could not enable edge sneak");
        }
        forcedKey = key;
        forcedKeyInjected = true;
    }

    private void releaseForcedSneak() {
        Object key = forcedKey;
        boolean injected = forcedKeyInjected;
        forcedKey = null;
        forcedKeyInjected = false;
        if (!injected || key == null || forcedKeyWasPressed) {
            return;
        }
        forcedKeyWasPressed = false;
        if (!Reflect.invoke(key, "setPressed", false)
                && !Reflect.setField(key, "isDown", false)) {
            throw new IllegalStateException("Could not restore player sneak state");
        }
    }

    private boolean solid(Object world, double x, double y, double z) {
        Object state = Worlds.blockState(world, x, y, z);
        if (state == null) {
            // An unloaded or unreadable position is treated as air so SafeWalk
            // errs toward sneaking instead of disabling itself mid-game.
            return false;
        }
        Class<?> blockPos = bl.mc.Types.find("net/minecraft/core/BlockPos");
        Object pos = blockPos == null ? null : Reflect.call(blockPos, "containing", x, y, z);
        if (pos == null) {
            return false;
        }
        Object shape = Reflect.call(state, "getCollisionShape", world, pos);
        if (shape != null) {
            Object empty = Reflect.call(shape, "isEmpty");
            if (empty instanceof Boolean isEmpty) {
                return !isEmpty;
            }
        }
        Object solid = Reflect.call(state, "isSolid");
        if (solid instanceof Boolean isSolid) {
            return isSolid;
        }
        Object air = Reflect.call(state, "isAir");
        if (air instanceof Boolean isAir) {
            return !isAir;
        }
        throw new IllegalStateException("Could not determine whether block below player is solid");
    }
}
