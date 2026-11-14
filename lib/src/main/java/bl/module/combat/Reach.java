package bl.module.combat;

import bl.AgentLock;
import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import net.minecraft.entity.Entity;

public final class Reach extends Module {

    public static Reach INSTANCE;

    /*
     * Reach changes the client's interaction attributes. Grim's reach threshold
     * is 3.0005 (config/en.yml:174-178), so anything above 3.0 is detectable;
     * 4.5 is the functional default for servers that permit it. Set both values
     * to 3.0 / 4.5 for the strict Grim-safe configuration.
     */
    private final Setting range = setting(Setting.decimal("Reach", 4.5, 3.0, 6.0));
    private final Setting blockRange = setting(Setting.decimal("Block reach", 5.0, 4.5, 6.0));

    private Object blockHolder;
    private Object entityHolder;
    private Double originalBlockRange;
    private Double originalEntityRange;

    public Reach() {
        super("Reach", Category.COMBAT, true);
        INSTANCE = this;
    }

    @Override
    protected void onEnable() {
        resolveHolders();
    }

    private void resolveHolders() {
        if (blockHolder != null && entityHolder != null) return;
        Class<?> attributes = Types.attributes();
        if (attributes == null) return;
        blockHolder = Reflect.call(attributes, "BLOCK_INTERACTION_RANGE");
        entityHolder = Reflect.call(attributes, "ENTITY_INTERACTION_RANGE");
    }

    @Override
    protected void onTick() {
        if (AgentLock.isLocked()) { disable(); return; }
        resolveHolders();
        if (blockHolder == null || entityHolder == null) {
            return;
        }
        apply(blockHolder, blockRange.getDouble(), true);
        apply(entityHolder, range.getDouble(), false);
    }

    /** HEAD of attackEntity; Reach does not defer attacks. */
    public boolean onAttack(Entity target) {
        return false;
    }

    public double range() {
        return range.getDouble();
    }

    /** Kept for the Bl send-hook; unused by the current timing path. */
    public void onPositionSent() {
    }

    @Override
    protected void onDisable() {
        restore(blockHolder, originalBlockRange);
        restore(entityHolder, originalEntityRange);
        originalBlockRange = null;
        originalEntityRange = null;
    }

    private void apply(Object holder, double target, boolean block) {
        if (holder == null) return;
        Object player = Reflect.player();
        if (player == null) return;
        Object instance = Reflect.call(player, "getAttribute", holder);
        if (instance == null) return;
        Object value = Reflect.call(instance, "getBaseValue");
        if (!(value instanceof Number number)) return;
        if (block) {
            if (originalBlockRange == null) originalBlockRange = number.doubleValue();
        } else {
            if (originalEntityRange == null) originalEntityRange = number.doubleValue();
        }
        if (Math.abs(number.doubleValue() - target) >= 0.001) {
            Reflect.call(instance, "setBaseValue", target);
        }
    }

    private void restore(Object holder, Double original) {
        if (holder == null || original == null) return;
        Object player = Reflect.player();
        Object instance = player == null ? null : Reflect.call(player, "getAttribute", holder);
        if (instance != null) Reflect.call(instance, "setBaseValue", original);
    }
}