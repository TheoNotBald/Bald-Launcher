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

    private final Setting edgeMargin = setting(Setting.decimal("Edge margin", 0.3, 0.1, 0.5));
    private final Setting includeDiagonalEdges = setting(Setting.bool("Check diagonal edges", true));
    private Object forcedPlayer;

    public SafeWalk() {
        super("SafeWalk", Category.MOVEMENT, true);
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
            Object sneaking = Reflect.call(player, "isShiftKeyDown");
            if (!(sneaking instanceof Boolean state)) {
                throw new IllegalStateException("Could not read player sneak state");
            }
            if (!state) {
                if (!Reflect.invoke(player, "setShiftKeyDown", true)) {
                    throw new IllegalStateException("Could not enable edge sneak");
                }
                forcedPlayer = player;
            }
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

    private void releaseForcedSneak() {
        Object player = forcedPlayer;
        if (player == null) {
            return;
        }
        Object current = Reflect.call(player, "isShiftKeyDown");
        Object mc = Reflect.instance();
        Object options = Reflect.getField(mc, "options");
        Object shiftKey = Reflect.getField(options, "keyShift");
        Object physicalState = Reflect.call(shiftKey, "isPressed");
        boolean shouldSneak = physicalState instanceof Boolean down && down;
        if (current instanceof Boolean state && state != shouldSneak
                && !Reflect.invoke(player, "setShiftKeyDown", shouldSneak)) {
            throw new IllegalStateException("Could not restore player sneak state");
        }
        forcedPlayer = null;
    }

    private boolean solid(Object world, double x, double y, double z) {
        Class<?> blockPos = bl.mc.Types.find("net/minecraft/core/BlockPos");
        if (blockPos == null) {
            throw new IllegalStateException("Minecraft BlockPos type is unavailable");
        }
        Object pos = Reflect.call(blockPos, "containing", x, y, z);
        if (pos == null) {
            throw new IllegalStateException("Could not create block position");
        }
        Object state = Reflect.call(world, "getBlockState", pos);
        if (state == null) {
            throw new IllegalStateException("Could not read block below player");
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
