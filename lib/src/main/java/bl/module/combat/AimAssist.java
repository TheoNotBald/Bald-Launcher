package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AimAssist extends Module {

    private final Setting range = setting(Setting.decimal("Range", 4.5, 2.0, 6.0));
    private final Setting strength = setting(Setting.decimal("Strength", 0.35, 0.05, 1.0));
    private final Setting players = setting(Setting.bool("Target players", true));
    private final Setting mobs = setting(Setting.bool("Target hostile mobs", true));

    public AimAssist() {
        super("AimAssist", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        Object options = Reflect.getField(Reflect.instance(), "options");
        Object attack = Reflect.getField(options, "keyAttack");
        if (player == null || !Boolean.TRUE.equals(Reflect.call(attack, "isDown"))) {
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
        float targetYaw = (float) Math.toDegrees(Math.atan2(dz, dx)) - 90.0f;
        float targetPitch = (float) -Math.toDegrees(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
        float yaw = Reflect.yaw() + wrap(targetYaw - Reflect.yaw()) * (float) strength.getDouble();
        float pitch = Reflect.pitch() + (targetPitch - Reflect.pitch()) * (float) strength.getDouble();
        Reflect.applyRotation(yaw, pitch);
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
}
