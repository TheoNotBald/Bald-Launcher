package bl.module.movement;

import java.util.List;

import bl.mc.KeyHold;
import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Speed extends Module {

    // Velocity writes the motion vector directly. Sprint jump does not touch
    // motion at all: it holds the vanilla jump key while moving on the ground,
    // which is the fastest movement the server already simulates.
    private final Setting mode = setting(Setting.enumeration("Mode", "Velocity", List.of("Velocity", "Sprint jump")));
    private final Setting horizontalSpeed = setting(Setting.decimal("Horizontal speed", 0.29, 0.1, 0.6,
            () -> mode.getEnum().equals("Velocity")));
    private final Setting allowAirControl = setting(Setting.bool("Allow air control", false,
            () -> mode.getEnum().equals("Velocity")));
    private final KeyHold jump = new KeyHold("keyJump", "jumpKey");

    public Speed() {
        super("Speed", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        if (mode.getEnum().equals("Sprint jump")) {
            sprintJump();
            return;
        }
        jump.release();
        Object player = Reflect.player();
        if (player == null || (!allowAirControl.getBool() && !Worlds.onGround(player)) || Worlds.inLiquid(player)) {
            return;
        }
        Object input = Reflect.getField(player, "input");
        Object moveVector = Reflect.call(input, "getMoveVector");
        if (moveVector == null) {
            throw new IllegalStateException("Could not read player movement input");
        }
        double strafe = component(moveVector, "x");
        double forward = component(moveVector, "y");
        double length = Math.sqrt(strafe * strafe + forward * forward);
        if (length < 0.01) {
            return;
        }
        double normalizedForward = forward / length * horizontalSpeed.getDouble();
        double normalizedStrafe = strafe / length * horizontalSpeed.getDouble();
        double yaw = Math.toRadians(Reflect.yaw());
        double dx = -Math.sin(yaw) * normalizedForward + Math.cos(yaw) * normalizedStrafe;
        double dz = Math.cos(yaw) * normalizedForward + Math.sin(yaw) * normalizedStrafe;
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null || !Reflect.invoke(player, "setDeltaMovement", dx, component(motion, "y"), dz)) {
            throw new IllegalStateException("Could not update player movement");
        }
    }

    @Override
    protected void onDisable() {
        jump.release();
    }

    @Override
    protected void onUnavailable() {
        jump.release();
    }

    private void sprintJump() {
        Object player = Reflect.player();
        if (player == null) {
            jump.release();
            return;
        }
        Object input = Reflect.getField(player, "input");
        Object moveVector = input == null ? null : Reflect.call(input, "getMoveVector");
        boolean moving = moveVector != null
                && Math.abs(component(moveVector, "x")) + Math.abs(component(moveVector, "y")) > 0.01;
        jump.set(moving && Worlds.onGround(player));
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.getField(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vec, axis);
        }
        return value instanceof Number number ? number.doubleValue() : 0.0;
    }
}
