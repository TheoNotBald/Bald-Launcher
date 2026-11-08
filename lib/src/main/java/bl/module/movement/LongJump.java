package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class LongJump extends Module {

    private final Setting velocity = setting(Setting.decimal("Velocity", 0.6, 0.2, 1.0));
    private final Setting requireJumpInput = setting(Setting.bool("Require jump input", true));
    private boolean airborne;

    public LongJump() {
        super("LongJump", Category.MOVEMENT);
    }

    @Override
    protected void onEnable() {
        airborne = false;
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            airborne = false;
            return;
        }
        boolean ground = Worlds.onGround(player);
        if (ground) {
            Object input = Reflect.getField(player, "input");
            Object keyPresses = Reflect.getField(input, "keyPresses");
            Object jump = Reflect.call(keyPresses, "jump");
            airborne = !requireJumpInput.getBool() || jump instanceof Boolean pressed && pressed;
            return;
        }
        if (airborne) {
            Object motion = Reflect.call(player, "getDeltaMovement");
            if (motion == null) {
                throw new IllegalStateException("Could not read player motion");
            }
            double x = component(motion, "x");
            double z = component(motion, "z");
            double length = Math.sqrt(x * x + z * z);
            if (length <= 0.01) {
                airborne = false;
                return;
            }
            double scale = velocity.getDouble() / length;
            if (!Reflect.invoke(player, "setDeltaMovement", x * scale, component(motion, "y"), z * scale)) {
                throw new IllegalStateException("Could not apply long-jump movement");
            }
            airborne = false;
        }
        airborne = true;
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.getField(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vec, axis);
        }
        return value instanceof Number number ? number.doubleValue() : 0.0;
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }
}
