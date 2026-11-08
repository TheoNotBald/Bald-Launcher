package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Speed extends Module {

    private final Setting horizontalSpeed = setting(Setting.decimal("Horizontal speed", 0.29, 0.1, 0.6));
    private final Setting allowAirControl = setting(Setting.bool("Allow air control", false));

    public Speed() {
        super("Speed", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || (!allowAirControl.getBool() && !Worlds.onGround(player)) || Worlds.inLiquid(player)) {
            return;
        }
        Object input = Reflect.getField(player, "input");
        Object moveVector = Reflect.call(input, "getMoveVector");
        if (moveVector == null) {
            throw new IllegalStateException("Could not read player movement input");
        }
        double strafe = component(moveVector, "x");
        double forward = component(moveVector, "y");
        double length = Math.sqrt(strafe * strafe + forward * forward);
        if (length < 0.01) {
            return;
        }
        double normalizedForward = forward / length * horizontalSpeed.getDouble();
        double normalizedStrafe = strafe / length * horizontalSpeed.getDouble();
        double yaw = Math.toRadians(Reflect.yaw());
        double dx = -Math.sin(yaw) * normalizedForward + Math.cos(yaw) * normalizedStrafe;
        double dz = Math.cos(yaw) * normalizedForward + Math.sin(yaw) * normalizedStrafe;
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null || !Reflect.invoke(player, "setDeltaMovement", dx, component(motion, "y"), dz)) {
            throw new IllegalStateException("Could not update player movement");
        }
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.getField(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vec, axis);
        }
        return value instanceof Number number ? number.doubleValue() : 0.0;
    }
}
