package bl.module.movement;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class NoJumpDelay extends Module {

    public NoJumpDelay() {
        super("NoJumpDelay", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player != null && !Reflect.setField(player, "noJumpDelay", 0)) {
            throw new IllegalStateException("Could not clear the jump cooldown");
        }
    }
}
