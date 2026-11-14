package bl.module.combat;

import bl.AgentLock;
import bl.mc.Reflect;
import bl.mc.Worlds;
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
    private final Setting onlyWithinReach = setting(Setting.bool("Only within reach", true));
    private final Setting mobs = setting(Setting.bool("Mobs", true));

    public int hits;

    public Hitboxes() {
        super("Hitboxes", Category.COMBAT, true);
        INSTANCE = this;
    }

    public double expansion() {
        if (!enabled || AgentLock.isLocked()) return 0.0;
        return expand.getDouble();
    }

    public boolean appliesTo(Entity entity) {
        if (!enabled || AgentLock.isLocked()) return false;
        if (entity == null || !(entity instanceof LivingEntity)) return false;
        if (entity instanceof MobEntity && !mobs.getBool()) return false;
        MinecraftClient mc = MinecraftClient.getInstance();
        return mc != null && entity != mc.player && entity.isAlive();
    }

    /**
     * Expands the box returned by {@code Entity#getBoundingBox}. The expansion
     * is capped so an attack aimed at the expanded edge still starts inside
     * the vanilla 3.0 interaction range; Hitboxes never changes reach itself.
     */
    public Object expand(Object rawBox, Object rawEntity) {
        if (!(rawBox instanceof Box box)) return rawBox;
        Entity entity = rawEntity instanceof Entity typed ? typed : null;
        if (!enabled || AgentLock.isLocked() || !appliesTo(entity)) return box;
        double expansion = expansion();
        if (expansion <= 0.0) return box;
        if (onlyWithinReach.getBool() && !withinReach(box, expansion)) return box;
        hits++;
        return box.expand(expansion);
    }

    private boolean withinReach(Box box, double expansion) {
        Object player = Reflect.player();
        if (player == null) return false;
        double x = Worlds.coordinate(player, "getX", "x");
        double y = Worlds.coordinate(player, "getY", "y");
        double z = Worlds.coordinate(player, "getZ", "z");
        Object eye = Reflect.call(player, "getEyeY");
        double eyeY = eye instanceof Number number ? number.doubleValue() : y + 1.62;
        if (!Double.isFinite(x) || !Double.isFinite(eyeY) || !Double.isFinite(z)) return false;

        double dx = Math.max(Math.max(box.minX - x, x - box.maxX), 0.0);
        double dy = Math.max(Math.max(box.minY - eyeY, eyeY - box.maxY), 0.0);
        double dz = Math.max(Math.max(box.minZ - z, z - box.maxZ), 0.0);
        double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return distance + expansion <= 3.0;
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
