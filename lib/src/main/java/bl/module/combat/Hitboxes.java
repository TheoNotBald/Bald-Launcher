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
     * Expands the box returned by {@code Entity#getBoundingBox}. The expanded
     * box must remain inside the vanilla 3.0 interaction range; Hitboxes never
     * changes reach itself.
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

        return isWithinReach(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ,
                expansion, x, eyeY, z);
    }

    static boolean isWithinReach(double minX, double minY, double minZ, double maxX, double maxY, double maxZ,
            double expansion, double x, double eyeY, double z) {
        if (!Double.isFinite(minX) || !Double.isFinite(minY) || !Double.isFinite(minZ)
                || !Double.isFinite(maxX) || !Double.isFinite(maxY) || !Double.isFinite(maxZ)
                || !Double.isFinite(expansion) || expansion < 0.0
                || !Double.isFinite(x) || !Double.isFinite(eyeY) || !Double.isFinite(z)) {
            return false;
        }

        double dx = Math.max(Math.max(minX - expansion - x, x - (maxX + expansion)), 0.0);
        double dy = Math.max(Math.max(minY - expansion - eyeY, eyeY - (maxY + expansion)), 0.0);
        double dz = Math.max(Math.max(minZ - expansion - z, z - (maxZ + expansion)), 0.0);
        return dx * dx + dy * dy + dz * dz <= 9.0;
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
