package bl.module.movement;

import java.util.List;

import bl.mc.KeyHold;
import bl.mc.Reflect;
import bl.mc.Types;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AntiWeb extends Module {

    public static AntiWeb INSTANCE;

    private static Object zeroVector;

    // Bypass rewrites the cobweb multiplier inside the vanilla hook. Escape
    // never touches movement at all: it only holds the jump key while the
    // player is inside a cobweb, which is how a vanilla player leaves one.
    private final Setting mode = setting(Setting.enumeration("Mode", "Bypass", List.of("Bypass", "Escape")));
    private final KeyHold jump = new KeyHold("keyJump", "jumpKey");

    public AntiWeb() {
        super("AntiWeb", Category.MOVEMENT);
        INSTANCE = this;
    }

    @Override
    protected void onTick() {
        if (!escape()) {
            jump.release();
            return;
        }
        if (Reflect.player() == null || !inCobweb()) {
            jump.release();
            return;
        }
        jump.set(true);
    }

    @Override
    protected void onDisable() {
        jump.release();
    }

    @Override
    protected void onUnavailable() {
        jump.release();
    }

    private boolean escape() {
        return mode.getEnum().equals("Escape");
    }

    private boolean inCobweb() {
        Object world = Reflect.world();
        if (world == null) {
            return false;
        }
        double x = Reflect.posX();
        double y = Reflect.posY();
        double z = Reflect.posZ();
        return Worlds.cobweb(world, x, y, z)
                || Worlds.cobweb(world, x, y + 0.5, z)
                || Worlds.cobweb(world, x, y + 1.0, z);
    }

    /**
     * Called by the Player.makeStuckInBlock hook immediately after vanilla stores
     * the cobweb multiplier. A zero multiplier makes Entity.move skip both the
     * speed reduction and its velocity reset, so momentum is preserved.
     */
    public void onStuckInBlock(Object entity, Object state) {
        if (!enabled || escape() || entity == null || entity != Reflect.player()) {
            return;
        }
        if (!isCobweb(state)) {
            return;
        }
        Object zero = zeroVector();
        if (zero == null || !Reflect.setFieldAny(entity, zero,
                "movementMultiplier", "stuckSpeedMultiplier")) {
            throw new IllegalStateException("Could not clear the cobweb movement multiplier");
        }
    }

    private boolean isCobweb(Object state) {
        if (state == null) {
            return false;
        }
        Object block = Reflect.call(state, "getBlock");
        return Types.isInstanceOf(block, "net/minecraft/block/CobwebBlock");
    }

    private Object zeroVector() {
        if (zeroVector == null) {
            Class<?> vec = Types.find("net/minecraft/world/phys/Vec3");
            if (vec != null) {
                zeroVector = Reflect.call(vec, "ZERO");
            }
        }
        return zeroVector;
    }
}
