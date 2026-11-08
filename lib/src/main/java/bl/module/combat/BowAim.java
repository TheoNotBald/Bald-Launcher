package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class BowAim extends Module {

    private final Setting range = setting(Setting.decimal("Range", 24.0, 8.0, 64.0));
    private final Setting smoothness = setting(Setting.decimal("Smoothness", 0.35, 0.05, 1.0));
    private final Setting players = setting(Setting.bool("Target players", true));
    private final Setting mobs = setting(Setting.bool("Target hostile mobs", true));

    public BowAim() {
        super("BowAim", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        Object hand = enumValue("net/minecraft/world/InteractionHand", "MAIN_HAND");
        Object stack = Reflect.call(player, "getItemInHand", hand);
        Object item = Reflect.call(stack, "getItem");
        Class<?> items = Types.find("net/minecraft/world/item/Items");
        Object bow = items == null ? null : Reflect.call(items, "BOW");
        Object crossbow = items == null ? null : Reflect.call(items, "CROSSBOW");
        if (item != bow && item != crossbow) {
            return;
        }
        Object options = Reflect.getField(Reflect.instance(), "options");
        Object useKey = Reflect.getField(options, "keyUse");
        if (!Boolean.TRUE.equals(Reflect.call(useKey, "isDown"))) {
            return;
        }
        Object target = null;
        double closest = range.getDouble() * range.getDouble();
        for (Object entity : Worlds.entitiesView()) {
            if (entity == player || !isTargetType(entity) || !Worlds.alive(entity)) {
                continue;
            }
            double distance = Worlds.distanceSquared(player, entity);
            if (Double.isFinite(distance) && distance < closest) {
                closest = distance;
                target = entity;
            }
        }
        if (target == null) {
            return;
        }
        double dx = Worlds.coordinate(target, "getX", "x") - Worlds.coordinate(player, "getX", "x");
        double dy = Worlds.coordinate(target, "getY", "y") + 0.8
                - (Worlds.coordinate(player, "getY", "y") + 1.5);
        double dz = Worlds.coordinate(target, "getZ", "z") - Worlds.coordinate(player, "getZ", "z");
        float yaw = (float) Math.toDegrees(Math.atan2(dz, dx)) - 90.0f;
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
        float nextYaw = Reflect.yaw() + wrap(yaw - Reflect.yaw()) * (float) smoothness.getDouble();
        float nextPitch = Reflect.pitch() + (pitch - Reflect.pitch()) * (float) smoothness.getDouble();
        Reflect.applyRotation(nextYaw, nextPitch);
    }

    private boolean isTargetType(Object entity) {
        return (players.getBool() && Worlds.isPlayer(entity))
                || (mobs.getBool() && Worlds.isHostileMob(entity));
    }

    private float wrap(float angle) {
        angle %= 360.0f;
        if (angle >= 180.0f) angle -= 360.0f;
        if (angle < -180.0f) angle += 360.0f;
        return angle;
    }

    private Object enumValue(String className, String name) {
        Class<?> type = Types.find(className);
        Object value = type == null ? null : Reflect.call(type, "valueOf", name);
        if (value == null) {
            throw new IllegalStateException("Could not resolve " + className + "." + name);
        }
        return value;
    }
}
