package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AutoSwim extends Module {

    private final Setting swimSpeed = setting(Setting.decimal("Swim speed", 0.18, 0.05, 0.5));

    public AutoSwim() {
        super("AutoSwim", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || !Worlds.inLiquid(player)) {
            return;
        }
        Object options = Reflect.getField(Reflect.instance(), "options");
        boolean up = Boolean.TRUE.equals(Reflect.call(Reflect.getField(options, "keyJump"), "isDown"));
        boolean down = Boolean.TRUE.equals(Reflect.call(Reflect.getField(options, "keyShift"), "isDown"));
        if (up == down) {
            return;
        }
        Object movement = Reflect.call(player, "getDeltaMovement");
        double vertical = up ? swimSpeed.getDouble() : -swimSpeed.getDouble();
        if (movement == null || !Reflect.invoke(player, "setDeltaMovement",
                component(movement, "x"), vertical, component(movement, "z"))) {
            throw new IllegalStateException("Could not adjust swimming motion");
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
            throw new IllegalStateException("Could not read swimming motion " + axis);
        }
        return number.doubleValue();
    }
}
