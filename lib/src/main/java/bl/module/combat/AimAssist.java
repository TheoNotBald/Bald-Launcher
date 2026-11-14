package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.rotation.RotationManager;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AimAssist extends Module {

    private final Setting range = setting(Setting.decimal("Range", 4.5, 2.0, 6.0));
    private final Setting strength = setting(Setting.decimal("Strength", 0.35, 0.05, 1.0));
    private final Setting players = setting(Setting.bool("Target players", true));
    private final Setting mobs = setting(Setting.bool("Target hostile mobs", true));

    private Object target;

    public AimAssist() {
        super("AimAssist", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        // KillAura owns the rotation when it has a live target; two writers cause missed swings.
        if (KillAura.INSTANCE != null && KillAura.INSTANCE.enabled
                && KillAura.INSTANCE.currentTarget() != null) {
            return;
        }
        Object player = Reflect.player();
        Object minecraft = Reflect.instance();
        if (player == null || minecraft == null
                || Reflect.fieldOfType(minecraft, "net/minecraft/client/gui/screens/Screen") != null) {
            target = null;
            return;
        }

        if (target == null || !isValidTarget(player, target)) {
            target = select(player);
        }
        if (target == null) {
            return;
        }

        double dx = Worlds.coordinate(target, "getX", "x") - Worlds.coordinate(player, "getX", "x");
        double dz = Worlds.coordinate(target, "getZ", "z") - Worlds.coordinate(player, "getZ", "z");
        double dy = eyeY(target) - eyeY(player);
        float targetYaw = (float) Math.toDegrees(Math.atan2(dz, dx)) - 90.0f;
        float targetPitch = (float) -Math.toDegrees(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
        targetPitch = Math.max(-90.0f, Math.min(90.0f, targetPitch));

        float strengthValue = (float) strength.getDouble();
        float maxTurn = 5.0f + 20.0f * strengthValue;
        float response = 0.25f + 0.40f * strengthValue;
        float yawDelta = clamp(wrap(targetYaw - Reflect.yaw()), -maxTurn, maxTurn);
        float pitchDelta = clamp(targetPitch - Reflect.pitch(), -maxTurn * 0.75f, maxTurn * 0.75f);
        float nextYaw = Reflect.yaw() + yawDelta * response;
        float nextPitch = Reflect.pitch() + pitchDelta * response;

        if (Math.abs(wrap(nextYaw - Reflect.yaw())) < 0.02f
                && Math.abs(nextPitch - Reflect.pitch()) < 0.02f) {
            return;
        }
        float step = RotationManager.gcdStep(Reflect.sensitivity());
        Reflect.applyRotation(
                RotationManager.snapToStep(nextYaw, step),
                RotationManager.snapToStep(nextPitch, step));
    }

    private Object select(Object player) {
        Object best = null;
        double closest = range.getDouble() * range.getDouble();
        for (Object entity : Worlds.entitiesView()) {
            if (entity == player || !isTargetType(entity) || !Worlds.alive(entity)) {
                continue;
            }
            double distance = Worlds.distanceSquared(player, entity);
            if (Double.isFinite(distance) && distance < closest) {
                closest = distance;
                best = entity;
            }
        }
        return best;
    }

    private boolean isValidTarget(Object player, Object candidate) {
        if (candidate == null || candidate == player || !isTargetType(candidate) || !Worlds.alive(candidate)) {
            return false;
        }
        double distance = Worlds.distanceSquared(player, candidate);
        return Double.isFinite(distance) && distance <= range.getDouble() * range.getDouble();
    }

    private double eyeY(Object entity) {
        Object value = Reflect.call(entity, "getEyeY");
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        double y = Worlds.coordinate(entity, "getY", "y");
        Object height = Reflect.call(entity, "getHeight");
        double h = height instanceof Number number ? number.doubleValue() : 1.8;
        return y + h * 0.85;
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

    private float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }
}
