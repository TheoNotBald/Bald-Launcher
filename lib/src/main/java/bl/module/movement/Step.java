package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Step extends Module {

    private final Setting height = setting(Setting.decimal("Height", 1.0, 0.6, 1.5));
    private Object stepHeightHolder;
    private Double originalHeight;

    public Step() {
        super("Step", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        if (stepHeightHolder == null) {
            Class<?> attributes = Types.attributes();
            stepHeightHolder = attributes == null ? null : Reflect.call(attributes, "STEP_HEIGHT");
        }
        if (stepHeightHolder == null) {
            throw new IllegalStateException("Minecraft step-height attribute is unavailable");
        }
        Object attribute = Reflect.call(player, "getAttribute", stepHeightHolder);
        if (attribute == null) {
            throw new IllegalStateException("Player has no step-height attribute");
        }
        Object current = Reflect.call(attribute, "getBaseValue");
        if (!(current instanceof Number number)) {
            throw new IllegalStateException("Could not read step-height attribute");
        }
        if (originalHeight == null) {
            originalHeight = number.doubleValue();
        }
        if (!Worlds.onGround(player)) {
            return;
        }
        double target = height.getDouble();
        if (Math.abs(number.doubleValue() - target) < 0.01) {
            return;
        }
        if (!Reflect.invoke(attribute, "setBaseValue", target)) {
            throw new IllegalStateException("Could not update step-height attribute");
        }
    }

    @Override
    protected void onDisable() {
        Object player = Reflect.player();
        Object attribute = player == null || stepHeightHolder == null
                ? null : Reflect.call(player, "getAttribute", stepHeightHolder);
        if (attribute != null && originalHeight != null
                && !Reflect.invoke(attribute, "setBaseValue", originalHeight)) {
            throw new IllegalStateException("Could not restore step-height attribute");
        }
        originalHeight = null;
        stepHeightHolder = null;
    }
}
