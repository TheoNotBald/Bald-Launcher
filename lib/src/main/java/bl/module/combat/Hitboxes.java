package bl.module.combat;

import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import net.minecraft.client.MinecraftClient;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.util.math.Box;

public final class Hitboxes extends Module {

    public static Hitboxes INSTANCE;

    private final Setting expand = setting(Setting.decimal("Expansion", 0.15, 0.0, 0.5));
    private final Setting mobs = setting(Setting.bool("Mobs", true));

    public int hits;

    public Hitboxes() {
        super("Hitboxes", Category.COMBAT, true);
        INSTANCE = this;
    }

    public double expansion() {
        if (!enabled) return 0.0;
        return expand.getDouble();
    }

    public boolean appliesTo(Entity entity) {
        if (!enabled) return false;
        if (entity == null || !(entity instanceof LivingEntity)) return false;
        if (entity instanceof MobEntity && !mobs.getBool()) return false;
        MinecraftClient mc = MinecraftClient.getInstance();
        return mc != null && entity != mc.player && entity.isAlive();
    }

    /**
     * Expands the box returned by {@code Entity#getBoundingBox}.
     *
     * <p>Grim never sees this box: it keeps its own copy of every entity and
     * measures reach against that one, so the expansion only moves our own
     * crosshair ray and is safe to draw at any distance. Anything it lets us
     * click past {@link GrimReach#LIMIT} is dropped by
     * {@link Reach#onAttack(Entity)} while the hit is still local, so no packet
     * the expansion produced ever reaches the server.
     */
    public Object expand(Object rawBox, Object rawEntity) {
        if (!(rawBox instanceof Box box)) return rawBox;
        Entity entity = rawEntity instanceof Entity typed ? typed : null;
        if (!enabled || !appliesTo(entity)) return box;
        double expansion = expansion();
        if (expansion <= 0.0) return box;
        hits++;
        return box.expand(expansion);
    }

    @Override
    protected void onEnable() {
        hits = 0;
    }

    @Override
    protected void onTick() {
    }

    @Override
    protected void onDisable() {
        System.out.println("[Bald Agent] Hitboxes bounding-box calls: " + hits);
    }
}
