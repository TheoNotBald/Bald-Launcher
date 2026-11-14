package bl.module.combat;

import java.util.List;

import bl.Bl;
import bl.event.events.ReceiveMotionEvent;
import bl.mc.Worlds;
import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.packet.PacketUtil;

public final class Velocity extends Module {

    /*
     * Jump reset is the vanilla mechanic described by MC-259487: jumping on the
     * same tick as the hit, while moving forward, reduces horizontal knockback.
     * MC-278103 states the jump has to happen on the tick the velocity change is
     * taken.
     *
     * In 1.21.11 the velocity packet is handled at the end of Minecraft.tick
     * (ClientConnection.tick runs after ClientWorld.tickEntities). The first tick
     * that simulates the new velocity is therefore the next client tick. Pressing
     * the jump key as the packet arrives and holding it through that next tick
     * makes vanilla Input.tick -> LivingEntity.jump run on the first tick that
     * uses the knockback, i.e. the same-tick jump reset.
     *
     * This module's onTick runs from the agent's end-of-client-tick hook, which
     * is the equivalent of Fabric's ClientTickEvents.END_CLIENT_TICK. That lets
     * the fallback see a velocity change in the same tick in which it is applied.
     *
     * Third-party jump-reset indicators use roughly 80 ms after impact, but that
     * value is not verified against vanilla or Grim. The default here is the
     * same-tick timing; any added delay is opt-in.
     */
    private final Setting mode = setting(Setting.enumeration("Velocity mode", "Jump reset",
            List.of("Jump reset", "Reduce knockback")));
    private final Setting jumpDelay = setting(Setting.integer("Jump delay", 0, 0, 3,
            this::jumpReset));
    private final Setting horizontal = setting(Setting.decimal("Horizontal knockback", 0.7, 0.0, 1.0,
            () -> !jumpReset()));
    private final Setting vertical = setting(Setting.decimal("Vertical knockback", 0.85, 0.0, 1.0,
            () -> !jumpReset()));
    private final Setting auraOnly = setting(Setting.bool("Only with KillAura", false));
    private final Setting groundedOnly = setting(Setting.bool("Only while grounded", false));

    private boolean jumpQueued;
    private int jumpDelayTicks;
    private int jumpRetryTicks;
    private boolean jumpKeyInjected;
    private int releaseTicks;
    private boolean velocitySeeded;
    private double lastVelocityX;
    private double lastVelocityY;
    private double lastVelocityZ;

    public Velocity() {
        super("Velocity", Category.COMBAT, true);
        Bl.bus().subscribe(this, ReceiveMotionEvent.class, event -> {
            if (!enabled || !isAvailable()) {
                return;
            }
            if (auraOnly.getBool() && !killAuraActive()) {
                return;
            }
            Object player = Reflect.player();
            if (player == null) {
                return;
            }
            if (groundedOnly.getBool() && !Worlds.onGround(player)) {
                return;
            }
            Object packetEntityId = Reflect.call(event.packet, "getEntityId");
            if (!(packetEntityId instanceof Number)) {
                packetEntityId = Reflect.call(event.packet, "getId");
            }
            Object playerEntityId = Reflect.call(player, "getId");
            if (!(packetEntityId instanceof Number packetId) || !(playerEntityId instanceof Number playerId)
                    || packetId.intValue() != playerId.intValue()) {
                return;
            }
            if (jumpReset()) {
                if (isFallDamage(event.packet)) {
                    return;
                }
                queueJump();
                return;
            }
            if (!PacketUtil.scaleMotion(event.packet, horizontal.getDouble(), vertical.getDouble())) {
                throw new IllegalStateException("Received motion event did not contain a recognized velocity packet");
            }
        });
    }

    private boolean killAuraActive() {
        return Bl.modules().stream().anyMatch(module -> module.name.equals("KillAura") && module.enabled);
    }

    private boolean jumpReset() {
        return mode.getEnum().equals("Jump reset");
    }

    private void queueJump() {
        if (jumpKeyInjected || !movingForward()) return;
        int delay = jumpDelay.getInt();
        jumpQueued = true;
        jumpDelayTicks = delay;
        jumpRetryTicks = 5;
        if (delay == 0 && pressJumpKey()) {
            jumpQueued = false;
            jumpRetryTicks = 0;
        }
    }

    private boolean pressJumpKey() {
        if (jumpKeyInjected) return true;
        Object minecraft = Reflect.instance();
        Object player = Reflect.player();
        if (minecraft == null || player == null || !Worlds.onGround(player)
                || Reflect.getField(minecraft, "currentScreen") != null) {
            return false;
        }
        Object jumpKey = jumpKey(minecraft);
        if (jumpKey == null || !movingForward(minecraft)) return false;
        if (Boolean.TRUE.equals(Reflect.call(jumpKey, "isPressed"))) {
            return true;
        }
        if (!Reflect.invoke(jumpKey, "setPressed", true)) {
            throw new IllegalStateException("Could not press the jump key for a jump reset");
        }
        jumpKeyInjected = true;
        releaseTicks = 1;
        return true;
    }

    private void releaseJumpKey() {
        if (!jumpKeyInjected) {
            return;
        }
        jumpKeyInjected = false;
        Object jumpKey = jumpKey();
        if (jumpKey == null) {
            return;
        }
        if (!Reflect.invoke(jumpKey, "setPressed", false)) {
            throw new IllegalStateException("Could not release the jump key after a jump reset");
        }
    }

    private Object jumpKey() {
        Object minecraft = Reflect.instance();
        return minecraft == null ? null : jumpKey(minecraft);
    }

    private Object jumpKey(Object minecraft) {
        Object options = Reflect.getField(minecraft, "options");
        return options == null ? null : Reflect.getField(options, "jumpKey");
    }

    private boolean movingForward() {
        Object minecraft = Reflect.instance();
        return minecraft != null && movingForward(minecraft);
    }

    private boolean movingForward(Object minecraft) {
        Object options = Reflect.getField(minecraft, "options");
        Object forward = options == null ? null : Reflect.getField(options, "forwardKey");
        return Boolean.TRUE.equals(Reflect.call(forward, "isPressed"));
    }

    private boolean isFallDamage(Object packet) {
        Object movement = Reflect.call(packet, "getVelocity");
        if (movement == null) {
            movement = Reflect.call(packet, "getMovement");
        }
        if (movement == null) {
            return false;
        }
        double x = component(movement, "x");
        double y = component(movement, "y");
        double z = component(movement, "z");
        return x == 0.0 && z == 0.0 && y < 0.0;
    }

    private double component(Object vector, String axis) {
        Object value = Reflect.getField(vector, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vector, axis);
        }
        if (!(value instanceof Number number)) {
            throw new IllegalStateException("Could not read velocity packet component " + axis);
        }
        return number.doubleValue();
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }

    @Override
    protected void onTick() {
        if (!jumpReset()) {
            jumpQueued = false;
            jumpRetryTicks = 0;
            releaseJumpKey();
            return;
        }
        detectKnockback();
        if (jumpKeyInjected) {
            if (releaseTicks > 0) {
                releaseTicks--;
            } else {
                releaseJumpKey();
            }
        }
        if (!jumpQueued) {
            return;
        }
        if (jumpDelayTicks > 0) {
            jumpDelayTicks--;
            return;
        }
        if (jumpRetryTicks <= 0) {
            jumpQueued = false;
            return;
        }
        jumpRetryTicks--;
        if (pressJumpKey()) {
            jumpQueued = false;
            jumpRetryTicks = 0;
        }
    }

    /**
     * The motion packet has already changed the player's velocity by the time
     * modules tick at the head of the next client tick. Watching that change is
     * a fallback for builds where the incoming-motion hook is not present; it
     * presses jump before the same tick's input is read.
     */
    private void detectKnockback() {
        Object player = Reflect.player();
        if (player == null) {
            velocitySeeded = false;
            return;
        }
        Object movement = Reflect.call(player, "getVelocity");
        if (movement == null) return;
        double x = componentOrNaN(movement, "x");
        double y = componentOrNaN(movement, "y");
        double z = componentOrNaN(movement, "z");
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) return;
        if (!velocitySeeded) {
            velocitySeeded = true;
            lastVelocityX = x;
            lastVelocityY = y;
            lastVelocityZ = z;
            return;
        }
        double deltaX = x - lastVelocityX;
        double deltaY = y - lastVelocityY;
        double deltaZ = z - lastVelocityZ;
        lastVelocityX = x;
        lastVelocityY = y;
        lastVelocityZ = z;
        if (jumpQueued || jumpKeyInjected) return;
        if (Math.hypot(deltaX, deltaZ) > 0.15
                && Math.hypot(x, z) > 0.28
                && (deltaY > 0.08 || Math.abs(y) > 0.20)) {
            queueJump();
        }
    }

    private double componentOrNaN(Object vector, String axis) {
        Object value = Reflect.getField(vector, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vector, axis);
        }
        return value instanceof Number number ? number.doubleValue() : Double.NaN;
    }

    @Override
    protected void onDisable() {
        jumpQueued = false;
        jumpDelayTicks = 0;
        jumpRetryTicks = 0;
        velocitySeeded = false;
        releaseJumpKey();
    }
}
