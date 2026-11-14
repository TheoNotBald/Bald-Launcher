package bl.module.combat;

import bl.Bl;
import bl.event.events.AttackEvent;
import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.util.TimerUtil;

public final class KillAura extends Module {

    public static KillAura INSTANCE;

    public Object currentTarget() {
        return target;
    }

    private final TimerUtil timer = new TimerUtil();

    private final Setting range = setting(Setting.decimal("Range", 3.0, 2.0, 6.0));
    private final Setting cps = setting(Setting.integer("CPS", 10, 1, 20));
    private final Setting mode = setting(Setting.enumeration("Target priority", "Distance",
            java.util.List.of("Distance", "Angle", "Health")));
    private final Setting rotationMode = setting(Setting.enumeration("Rotation mode", "Smooth",
            java.util.List.of("Instant", "Smooth", "Snap")));
    private final Setting fieldOfView = setting(Setting.decimal("Field of view", 180.0, 30.0, 360.0));
    private final Setting sprintOnly = setting(Setting.bool("Only while sprinting", false));
    private final Setting players = setting(Setting.bool("Target players", false));
    private final Setting mobs = setting(Setting.bool("Target hostile mobs", true));
    private final Setting requireLineOfSight = setting(Setting.bool("Require line of sight", true));
    private final Setting scanInterval = setting(Setting.integer("Target scan interval", 3, 1, 10));
    private final Setting respectCooldown = setting(Setting.bool("Respect attack cooldown", true));
    private final Setting cooldown = setting(Setting.integer("Attack cooldown", 90, 0, 100));

    private Object target;
    private int ticksUntilScan;
    private long nextAttackDelay;

    public KillAura() {
        super("KillAura", Category.COMBAT, true);
        INSTANCE = this;
        Bl.bus().subscribe(this, AttackEvent.class, event -> {
            if (event.target == target) {
                timer.reset();
            }
        });
    }

    @Override
    protected void onEnable() {
        target = null;
        ticksUntilScan = 0;
        nextAttackDelay = 0;
        timer.reset();
    }

    @Override
    protected void onDisable() {
        target = null;
        ticksUntilScan = 0;
        rotations().reset();
    }

    @Override
    protected void onUnavailable() {
        clearTarget();
    }

    @Override
    protected void onTick() {
        rotations().setMode(switch (rotationMode.getEnum()) {
            case "Instant" -> bl.rotation.RotationManager.Mode.INSTANT;
            case "Snap" -> bl.rotation.RotationManager.Mode.SNAP;
            default -> bl.rotation.RotationManager.Mode.SMOOTH;
        });
        Object screen = Reflect.fieldOfType(Reflect.instance(), "net/minecraft/client/gui/screens/Screen");
        if (screen != null) {
            clearTarget();
            return;
        }
        Object player = Reflect.player();
        if (player == null) {
            clearTarget();
            return;
        }
        if (sprintOnly.getBool() && !isSprinting(player)) {
            clearTarget();
            return;
        }

        if (target != null && !isValidTarget(player, target)) {
            target = null;
            ticksUntilScan = 0;
        }
        if (ticksUntilScan <= 0) {
            Object candidate = select(player);
            ticksUntilScan = scanInterval.getInt() - 1;
            if (candidate != target) {
                target = candidate;
                timer.reset();
            }
        } else {
            ticksUntilScan--;
        }
        if (target == null) {
            rotations().reset();
            return;
        }

        float[] angles = angles(player, target);
        rotations().request(angles[0], angles[1]);

        if (!rotations().isReady()) {
            return;
        }

        if (!timer.passed(nextAttackDelay)) {
            return;
        }
        if (respectCooldown.getBool() && attackCooldown(player) < cooldown.getInt() / 100.0f) {
            return;
        }
        attack(player, target);
        Worlds.swingMainHand(player);
        nextAttackDelay = 1000L / cps.getInt();
        timer.reset();
    }

    private void clearTarget() {
        target = null;
        ticksUntilScan = 0;
        rotations().reset();
    }

    private double effectiveRange() {
        if (Reach.INSTANCE != null && Reach.INSTANCE.enabled) {
            return Reach.INSTANCE.range();
        }
        return range.getDouble();
    }

    private boolean isSprinting(Object player) {
        Object value = Reflect.call(player, "isSprinting");
        return value instanceof Boolean bool && bool;
    }

    private float attackCooldown(Object player) {
        Object value = Reflect.call(player, "getAttackStrengthScale", 0.5f);
        return value instanceof Number number ? number.floatValue() : 0.0f;
    }

    private void attack(Object player, Object entity) {
        Object gameMode = Reflect.fieldOfType(Reflect.instance(), "net/minecraft/client/multiplayer/MultiPlayerGameMode");
        if (gameMode == null || !Reflect.invoke(gameMode, "attack", player, entity)) {
            throw new IllegalStateException("Could not attack the selected target");
        }
    }

    private Object select(Object player) {
        Object best = null;
        double bestMetric = Double.MAX_VALUE;
        double maximumDistance = effectiveRange();
        double maximumDistanceSquared = maximumDistance * maximumDistance;
        double playerX = Worlds.coordinate(player, "getX", "x");
        double playerY = Worlds.coordinate(player, "getY", "y");
        double playerZ = Worlds.coordinate(player, "getZ", "z");
        float playerYaw = Reflect.yaw();
        for (Object entity : Worlds.entitiesView()) {
            if (entity == player) {
                continue;
            }
            boolean playerTarget = players.getBool() && Worlds.isPlayer(entity);
            boolean mobTarget = mobs.getBool() && Worlds.isHostileMob(entity);
            if ((!playerTarget && !mobTarget) || !Worlds.alive(entity)) {
                continue;
            }
            double dx = Worlds.coordinate(entity, "getX", "x") - playerX;
            double dy = Worlds.coordinate(entity, "getY", "y") - playerY;
            double dz = Worlds.coordinate(entity, "getZ", "z") - playerZ;
            double distanceSquared = dx * dx + dy * dy + dz * dz;
            if (!Double.isFinite(distanceSquared) || distanceSquared > maximumDistanceSquared) {
                continue;
            }
            if (Math.abs(angleDelta(playerYaw, yawTo(dx, dz))) > fieldOfView.getDouble() / 2.0) {
                continue;
            }
            if (requireLineOfSight.getBool() && !lineOfSight(player, entity)) {
                continue;
            }
            double metric = switch (mode.getEnum()) {
                case "Angle" -> Math.abs(angleDelta(playerYaw,
                        yawTo(dx, dz)));
                case "Health" -> Worlds.health(entity);
                default -> distanceSquared;
            };
            if (metric < bestMetric) {
                bestMetric = metric;
                best = entity;
            }
        }
        return best;
    }

    private boolean isValidTarget(Object player, Object candidate) {
        if (!Worlds.alive(candidate)) {
            return false;
        }
        boolean playerTarget = players.getBool() && Worlds.isPlayer(candidate);
        boolean mobTarget = mobs.getBool() && Worlds.isHostileMob(candidate);
        if (!playerTarget && !mobTarget) {
            return false;
        }
        double distanceSquared = Worlds.distanceSquared(player, candidate);
        double maximumDistance = effectiveRange();
        if (!Double.isFinite(distanceSquared) || distanceSquared > maximumDistance * maximumDistance) {
            return false;
        }
        return !requireLineOfSight.getBool() || lineOfSight(player, candidate);
    }

    private boolean lineOfSight(Object player, Object entity) {
        Object visible = Reflect.call(player, "hasLineOfSight", entity);
        return visible instanceof Boolean canSee && canSee;
    }

    private float[] angles(Object player, Object entity) {
        double dx = Worlds.coordinate(entity, "getX", "x") - Worlds.coordinate(player, "getX", "x");
        double dz = Worlds.coordinate(entity, "getZ", "z") - Worlds.coordinate(player, "getZ", "z");
        double dy = eyeY(entity) - eyeY(player);
        double horizontalDistance = Math.sqrt(dx * dx + dz * dz);
        float yaw = yawTo(dx, dz);
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, horizontalDistance));
        return new float[] { yaw, pitch };
    }

    private float yawTo(double dx, double dz) {
        return (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
    }

    private double eyeY(Object entity) {
        Object value = Reflect.call(entity, "getEyeY");
        return value instanceof Number number ? number.doubleValue()
                : Worlds.coordinate(entity, "getY", "y") + 1.5;
    }

    private double angleDelta(float a, float b) {
        double delta = ((b - a) % 360.0 + 540.0) % 360.0 - 180.0;
        return delta;
    }
}
