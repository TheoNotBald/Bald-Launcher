package bl.module.movement;

import java.util.List;

import bl.mc.KeyHold;
import bl.mc.Reflect;
import bl.mc.Types;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Step extends Module {

    // Height raises the step-height attribute, which no server validates.
    // Auto jump keeps the attribute untouched and instead holds the jump key
    // when a one-block ledge blocks the player, so the server simulates a
    // normal jump.
    private final Setting mode = setting(Setting.enumeration("Mode", "Height", List.of("Height", "Auto jump")));
    private final Setting height = setting(Setting.decimal("Height", 1.0, 0.6, 1.5,
            () -> mode.getEnum().equals("Height")));
    private final KeyHold jump = new KeyHold("keyJump", "jumpKey");
    private Object stepHeightHolder;
    private Double originalHeight;

    public Step() {
        super("Step", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        if (mode.getEnum().equals("Auto jump")) {
            autoJump();
            return;
        }
        jump.release();
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        if (stepHeightHolder == null) {
            Class<?> attributes = Types.attributes();
            stepHeightHolder = attributes == null ? null : Reflect.call(attributes, "STEP_HEIGHT");
        }
        if (stepHeightHolder == null) {
            throw new IllegalStateException("Minecraft step-height attribute is unavailable");
        }
        Object attribute = Reflect.call(player, "getAttribute", stepHeightHolder);
        if (attribute == null) {
            throw new IllegalStateException("Player has no step-height attribute");
        }
        Object current = Reflect.call(attribute, "getBaseValue");
        if (!(current instanceof Number number)) {
            throw new IllegalStateException("Could not read step-height attribute");
        }
        if (originalHeight == null) {
            originalHeight = number.doubleValue();
        }
        if (!Worlds.onGround(player)) {
            return;
        }
        double target = height.getDouble();
        if (Math.abs(number.doubleValue() - target) < 0.01) {
            return;
        }
        if (!Reflect.invoke(attribute, "setBaseValue", target)) {
            throw new IllegalStateException("Could not update step-height attribute");
        }
    }

    @Override
    protected void onDisable() {
        jump.release();
        Object player = Reflect.player();
        Object attribute = player == null || stepHeightHolder == null
                ? null : Reflect.call(player, "getAttribute", stepHeightHolder);
        if (attribute != null && originalHeight != null
                && !Reflect.invoke(attribute, "setBaseValue", originalHeight)) {
            throw new IllegalStateException("Could not restore step-height attribute");
        }
        originalHeight = null;
        stepHeightHolder = null;
    }

    @Override
    protected void onUnavailable() {
        jump.release();
    }

    private void autoJump() {
        Object player = Reflect.player();
        if (player == null) {
            jump.release();
            return;
        }
        Object input = Reflect.getField(player, "input");
        Object moveVector = input == null ? null : Reflect.call(input, "getMoveVector");
        boolean moving = moveVector != null
                && Math.abs(component(moveVector, "x")) + Math.abs(component(moveVector, "y")) > 0.01;
        jump.set(moving && Worlds.onGround(player) && blocked(player) && oneBlockStep(player));
    }

    private boolean blocked(Object player) {
        Object value = Reflect.getField(player, "horizontalCollision");
        if (!(value instanceof Boolean)) {
            value = Reflect.call(player, "horizontalCollision");
        }
        return Boolean.TRUE.equals(value);
    }

    private boolean oneBlockStep(Object player) {
        Object world = Reflect.world();
        if (world == null) {
            return false;
        }
        double yaw = Math.toRadians(Reflect.yaw());
        double x = Reflect.posX() - Math.sin(yaw) * 0.4;
        double z = Reflect.posZ() + Math.cos(yaw) * 0.4;
        double y = Reflect.posY();
        return Worlds.solid(world, x, y + 1.0, z) && !Worlds.solid(world, x, y + 2.2, z);
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.getField(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vec, axis);
        }
        return value instanceof Number number ? number.doubleValue() : 0.0;
    }
}
