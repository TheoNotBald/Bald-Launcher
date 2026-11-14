package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class NoSlow extends Module {

    private final Setting horizontalSpeed = setting(Setting.decimal("Movement speed", 0.1, 0.05, 0.3));

    public NoSlow() {
        super("NoSlow", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || !Boolean.TRUE.equals(Reflect.call(player, "isUsingItem"))
                || Worlds.inLiquid(player)) {
            return;
        }
        Object input = Reflect.getField(player, "input");
        Object move = Reflect.call(input, "getMoveVector");
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null || move == null) {
            throw new IllegalStateException("Could not read player movement while using an item");
        }
        double strafe = component(move, "x");
        double forward = component(move, "y");
        double length = Math.sqrt(strafe * strafe + forward * forward);
        if (length < 0.01) {
            return;
        }
        forward = forward / length * horizontalSpeed.getDouble();
        strafe = strafe / length * horizontalSpeed.getDouble();
        double yaw = Math.toRadians(Reflect.yaw());
        double x = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
        double z = Math.cos(yaw) * forward + Math.sin(yaw) * strafe;
        if (!Reflect.invoke(player, "setDeltaMovement",
                x,
                component(motion, "y"),
                z)) {
            throw new IllegalStateException("Could not update player movement while using an item");
        }
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
