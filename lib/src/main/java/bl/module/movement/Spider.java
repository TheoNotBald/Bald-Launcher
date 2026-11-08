package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Spider extends Module {

    private final Setting climbSpeed = setting(Setting.decimal("Climb speed", 0.25, 0.1, 0.5));

    public Spider() {
        super("Spider", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || Worlds.onGround(player) || Worlds.inLiquid(player)
                || !Boolean.TRUE.equals(Reflect.getField(player, "horizontalCollision"))) {
            return;
        }
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null || !Reflect.invoke(player, "setDeltaMovement",
                component(motion, "x"), climbSpeed.getDouble(), component(motion, "z"))) {
            throw new IllegalStateException("Could not apply wall-climb motion");
        }
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.call(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.getField(vec, axis);
        }
        if (!(value instanceof Number number)) {
            throw new IllegalStateException("Could not read movement " + axis);
        }
        return number.doubleValue();
    }
}
