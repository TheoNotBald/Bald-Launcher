package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Reach extends Module {

    private final Setting entityRange = setting(Setting.decimal("Entity range", 4.5, 3.0, 6.0));
    private final Setting blockRange = setting(Setting.decimal("Block range", 5.0, 4.5, 6.0));

    private Object blockHolder;
    private Object entityHolder;
    private Double originalBlockRange;
    private Double originalEntityRange;

    public Reach() {
        super("Reach", Category.COMBAT);
    }

    @Override
    protected void onEnable() {
        resolveHolders();
    }

    private void resolveHolders() {
        if (blockHolder != null && entityHolder != null) {
            return;
        }
        Class<?> attributes = Types.attributes();
        if (attributes == null) {
            return;
        }
        blockHolder = Reflect.call(attributes, "BLOCK_INTERACTION_RANGE");
        entityHolder = Reflect.call(attributes, "ENTITY_INTERACTION_RANGE");
    }

    @Override
    protected void onTick() {
        resolveHolders();
        if (blockHolder == null || entityHolder == null) {
            throw new IllegalStateException("Minecraft interaction range attributes are unavailable");
        }
        apply(blockHolder, blockRange.getDouble(), true);
        apply(entityHolder, entityRange.getDouble(), false);
    }

    @Override
    protected void onDisable() {
        restore(blockHolder, originalBlockRange);
        restore(entityHolder, originalEntityRange);
        originalBlockRange = null;
        originalEntityRange = null;
    }

    private void apply(Object holder, double target, boolean block) {
        if (holder == null) {
            return;
        }
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        Object instance = Reflect.call(player, "getAttribute", holder);
        if (instance == null) {
            return;
        }
        Object value = Reflect.call(instance, "getBaseValue");
        if (!(value instanceof Number number)) {
            return;
        }
        if (block && originalBlockRange == null) {
            originalBlockRange = number.doubleValue();
        } else if (!block && originalEntityRange == null) {
            originalEntityRange = number.doubleValue();
        }
        if (Math.abs(number.doubleValue() - target) >= 0.001) {
            Reflect.call(instance, "setBaseValue", target);
        }
    }

    private void restore(Object holder, Double original) {
        if (holder == null || original == null) {
            return;
        }
        Object player = Reflect.player();
        Object instance = player == null ? null : Reflect.call(player, "getAttribute", holder);
        if (instance != null) {
            Reflect.call(instance, "setBaseValue", original);
        }
    }
}
