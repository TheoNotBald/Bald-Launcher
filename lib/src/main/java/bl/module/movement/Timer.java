package bl.module.movement;

import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Timer extends Module {

    private final Setting speed = setting(Setting.decimal("Speed", 1.00, 0.0, 20.0));
    private Float originalTickLength;

    public Timer() {
        super("Timer", Category.WORLD);
    }

    @Override
    protected void onTick() {
        Object mc = bl.mc.Reflect.instance();
        if (mc == null) {
            return;
        }
        Object timer = bl.mc.Reflect.fieldOfType(mc, "net/minecraft/client/DeltaTracker$Timer");
        if (timer == null) {
            return;
        }
        Object current = bl.mc.Reflect.getField(timer, "msPerTick");
        if (current instanceof Number number) {
            if (originalTickLength == null) {
                originalTickLength = number.floatValue();
            }
            double multiplier = speed.getDouble();
            float target = multiplier == 0.0 ? Float.MAX_VALUE : (float) (50.0 / multiplier);
            if (Math.abs(number.doubleValue() - target) > 0.01) {
                if (!bl.mc.Reflect.setField(timer, "msPerTick", target)) {
                    throw new IllegalStateException("Could not update client tick length");
                }
            }
        } else {
            throw new IllegalStateException("Could not read client tick length");
        }
    }

    @Override
    protected void onDisable() {
        Object mc = bl.mc.Reflect.instance();
        Object timer = bl.mc.Reflect.fieldOfType(mc, "net/minecraft/client/DeltaTracker$Timer");
        if (timer != null && originalTickLength != null
                && !bl.mc.Reflect.setField(timer, "msPerTick", originalTickLength)) {
            throw new IllegalStateException("Could not restore client tick length");
        }
        originalTickLength = null;
    }
}
