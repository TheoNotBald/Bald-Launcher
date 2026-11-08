package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class ReverseStep extends Module {

    private final Setting speed = setting(Setting.decimal("Downward speed", 0.55, 0.2, 1.5));

    public ReverseStep() {
        super("ReverseStep", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || Worlds.onGround(player) || Worlds.inLiquid(player)) {
            return;
        }
        Object motion = Reflect.call(player, "getDeltaMovement");
        double y = component(motion, "y");
        if (y >= -speed.getDouble()
                && !Reflect.invoke(player, "setDeltaMovement",
                        component(motion, "x"), -speed.getDouble(), component(motion, "z"))) {
            throw new IllegalStateException("Could not increase downward movement");
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
