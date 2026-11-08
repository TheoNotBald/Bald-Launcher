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
        if (player == null || !Boolean.TRUE.equals(Reflect.call(player, "onClimbable"))) {
            return;
        }
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null || !Reflect.invoke(player, "setDeltaMovement",
                component(motion, "x"), Math.max(component(motion, "y"), climbSpeed.getDouble()),
                component(motion, "z"))) {
            throw new IllegalStateException("Could not apply ladder climbing speed");
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
