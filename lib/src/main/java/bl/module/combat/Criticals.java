package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Criticals extends Module {

    private final Setting minimumFallDistance = setting(Setting.decimal("Minimum fall distance", 0.08, 0.01, 0.5));
    private final Setting maximumWait = setting(Setting.integer("Maximum wait", 20, 2, 60));
    private final Setting avoidSlowFalling = setting(Setting.bool("Avoid slow falling", true));
    private final Setting allowInLiquid = setting(Setting.bool("Allow in liquids", false));

    private Object pendingGameMode;
    private Object pendingPlayer;
    private Object pendingTarget;
    private int waitTicks;
    private boolean executingQueuedAttack;

    public Criticals() {
        super("Criticals", Category.COMBAT, true);
    }

    public boolean interceptAttack(Object gameMode, Object player, Object target) {
        if (!enabled || !isAvailable() || executingQueuedAttack || target == null || player == null) {
            return false;
        }
        if (pendingTarget != null) {
            return pendingTarget == target;
        }
        if (!Worlds.onGround(player) || !canJumpForCritical(player)) {
            return false;
        }
        if (!Reflect.invoke(player, "jumpFromGround")) {
            throw new IllegalStateException("Could not start critical jump");
        }
        pendingGameMode = gameMode;
        pendingPlayer = player;
        pendingTarget = target;
        waitTicks = 0;
        return true;
    }

    @Override
    protected void onTick() {
        if (pendingTarget == null) {
            return;
        }
        Object player = Reflect.player();
        if (player != pendingPlayer || !Worlds.alive(pendingTarget)) {
            clearPending();
            return;
        }
        waitTicks++;
        if (canLandCritical(player) || waitTicks >= maximumWait.getInt()) {
            executeQueuedAttack();
        }
    }

    @Override
    protected void onDisable() {
        if (pendingTarget != null && pendingGameMode != null
                && pendingPlayer == Reflect.player() && Worlds.alive(pendingTarget)) {
            executeQueuedAttack();
        } else {
            clearPending();
        }
    }

    @Override
    protected void onUnavailable() {
        clearPending();
    }

    private boolean canJumpForCritical(Object player) {
        if (!allowInLiquid.getBool() && Worlds.inLiquid(player)) {
            return false;
        }
        Object vehicle = Reflect.call(player, "isPassenger");
        if (vehicle instanceof Boolean passenger && passenger) {
            return false;
        }
        if (!avoidSlowFalling.getBool()) {
            return true;
        }
        Class<?> effects = bl.mc.Types.find("net/minecraft/world/effect/MobEffects");
        if (effects == null) {
            return false;
        }
        Object slowFallingEffect = Reflect.call(effects, "SLOW_FALLING");
        if (slowFallingEffect == null) {
            return false;
        }
        Object hasEffect = Reflect.call(player, "hasEffect", slowFallingEffect);
        return !(hasEffect instanceof Boolean active) || !active;
    }

    private boolean canLandCritical(Object player) {
        if (Worlds.onGround(player) || (!allowInLiquid.getBool() && Worlds.inLiquid(player))) {
            return false;
        }
        Object movement = Reflect.call(player, "getDeltaMovement");
        double distance = Worlds.fallDistance(player);
        if (!Double.isFinite(distance) || movement == null) {
            return false;
        }
        Object vertical = Reflect.call(movement, "y");
        Number yVelocity;
        if (vertical instanceof Number number) {
            yVelocity = number;
        } else {
            vertical = Reflect.getField(movement, "y");
            if (!(vertical instanceof Number)) {
                return false;
            }
            yVelocity = (Number) vertical;
        }
        return yVelocity.doubleValue() < 0.0 && distance >= minimumFallDistance.getDouble();
    }

    private void executeQueuedAttack() {
        Object gameMode = pendingGameMode;
        Object player = pendingPlayer;
        Object target = pendingTarget;
        clearPending();
        if (gameMode == null || player == null || target == null) {
            return;
        }
        executingQueuedAttack = true;
        try {
            if (!Reflect.invoke(gameMode, "attack", player, target)) {
                throw new IllegalStateException("Could not execute queued critical attack");
            }
            Worlds.swingMainHand(player);
        } finally {
            executingQueuedAttack = false;
        }
    }

    private void clearPending() {
        pendingGameMode = null;
        pendingPlayer = null;
        pendingTarget = null;
        waitTicks = 0;
    }
}
