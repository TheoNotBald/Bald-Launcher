package bl.module.combat;

import java.util.List;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import net.minecraft.entity.Entity;

public final class Reach extends Module {

    public static Reach INSTANCE;

    /*
     * The interaction attributes below are client-side only. The server keeps its
     * own ENTITY_INTERACTION_RANGE at 3.0, and Grim measures eye-to-box against
     * its own copy of the target's hitbox, so a slider value of 4.5 does not
     * extend Grim's estimate by a millimetre; it only lets the crosshair pick
     * targets that Grim then rejects.
     *
     * "Grim" therefore hands out GrimReach.LIMIT (3.0255) and refuses anything
     * past it. "Raw" keeps the old behaviour for servers without Grim.
     */
    /*
     * Grim's Reach check returns before it queues or measures anything while the
     * player is riding a vehicle, and again while the target is riding one
     * (Reach#onInteract: "if (player.inVehicle()) return;" and
     * "if (entity.riding != null) return;"). "Mounted" spends the slider value
     * unclamped in exactly those two states and the 3.0255 budget everywhere
     * else, so a 4.0 hit only ever leaves the client while the server has
     * stopped measuring. "Raw" never clamps, "Grim" never opens up.
     */
    private final Setting mode = setting(Setting.enumeration("Mode", "Grim",
            List.of("Grim", "Mounted", "Raw")));
    private final Setting range = setting(Setting.decimal("Reach", 4.0, 3.0, 6.0));
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
        resolveHolders();
        if (blockHolder == null || entityHolder == null) {
            return;
        }
        apply(blockHolder, blockRange.getDouble(), true);
        apply(entityHolder, range(), false);
    }

    /**
     * HEAD of the attack packet. In Grim mode a hit the server would measure as
     * out of range is dropped before it is sent, so the reject never leaves the
     * client; that is the only outcome Grim cannot flag.
     */
    public boolean onAttack(Entity target) {
        if (!enabled || target == null || !checked(target)) {
            return false;
        }
        Object player = Reflect.player();
        if (player == null) {
            return false;
        }
        double x = number(Reflect.call(player, "getX"));
        double y = number(Reflect.call(player, "getY"));
        double z = number(Reflect.call(player, "getZ"));
        double rawEyeY = number(Reflect.call(player, "getEyeY"));
        double eyeY = Double.isFinite(rawEyeY) ? rawEyeY : y + 1.62;
        if (!Double.isFinite(x) || !Double.isFinite(z) || !Double.isFinite(eyeY)) {
            return false;
        }
        // Entity#getBoundingBox is routed through Hitboxes, so rebuild the real
        // box from the dimensions the server also uses.
        double half = target.getWidth() / 2.0;
        double targetX = target.getX();
        double targetY = target.getY();
        double targetZ = target.getZ();
        return !GrimReach.withinLimit(
                targetX - half, targetY, targetZ - half,
                targetX + half, targetY + target.getHeight(), targetZ + half,
                x, eyeY, z);
    }

    /** Range actually handed to the client, clamped whenever Grim measures the hit. */
    public double range() {
        double requested = range.getDouble();
        return checked(null) ? Math.min(requested, GrimReach.LIMIT) : requested;
    }

    /** True when Grim measures this hit, so the slider has to stay inside its budget. */
    public boolean checked(Entity target) {
        return checked(mode.getEnum(), mounted(null), mounted(target));
    }

    static boolean checked(String selected, boolean selfMounted, boolean targetMounted) {
        if ("Raw".equals(selected)) {
            return false;
        }
        if ("Grim".equals(selected)) {
            return true;
        }
        return !(selfMounted || targetMounted);
    }

    /** Null reads our own rider; an unknown vehicle name counts as on foot, which clamps. */
    private static boolean mounted(Entity entity) {
        if (entity == null) {
            Object player = Reflect.player();
            return player != null && Reflect.call(player, "getVehicle") != null;
        }
        return Reflect.call(entity, "getVehicle") != null;
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

    private static double number(Object value) {
        return value instanceof Number number ? number.doubleValue() : Double.NaN;
    }

    private void restore(Object holder, Double original) {
        if (holder == null || original == null) return;
        Object player = Reflect.player();
        Object instance = player == null ? null : Reflect.call(player, "getAttribute", holder);
        if (instance != null) Reflect.call(instance, "setBaseValue", original);
    }
}