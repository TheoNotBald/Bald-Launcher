package bl.module.movement;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class FastLadder extends Module {

    private final Setting climbSpeed = setting(Setting.decimal("Climb speed", 0.3, 0.1, 0.6));

    public FastLadder() {
        super("FastLadder", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || !climbing(player)) {
            return;
        }
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null) {
            motion = Reflect.call(player, "getVelocity");
        }
        if (motion == null || !Reflect.invoke(player, "setDeltaMovement",
                component(motion, "x"), Math.max(component(motion, "y"), climbSpeed.getDouble()),
                component(motion, "z"))) {
            throw new IllegalStateException("Could not apply ladder climbing speed");
        }
    }

    private boolean climbing(Object player) {
        Object value = Reflect.call(player, "onClimbable");
        if (value instanceof Boolean climbing && climbing) {
            return true;
        }
        value = Reflect.call(player, "isClimbing");
        return value instanceof Boolean climbing && climbing;
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
