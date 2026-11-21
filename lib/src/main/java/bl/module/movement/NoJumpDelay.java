package bl.module.movement;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class NoJumpDelay extends Module {

    public NoJumpDelay() {
        super("NoJumpDelay", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        if (!clearCooldown(player)) {
            throw new IllegalStateException("Could not clear the jump cooldown");
        }
    }

    private boolean clearCooldown(Object player) {
        // 1.21.11: Yarn jumpingCooldown / Mojang noJumpDelay, field_6228.
        // Try each alias separately so one stale mapping cannot hide the field.
        for (String name : new String[] { "jumpingCooldown", "noJumpDelay", "field_6228" }) {
            Object current = Reflect.getField(player, name);
            if (current instanceof Number) {
                return Reflect.setField(player, name, 0);
            }
        }
        return Reflect.setFieldAny(player, 0, "jumpingCooldown", "noJumpDelay", "field_6228");
    }
}
