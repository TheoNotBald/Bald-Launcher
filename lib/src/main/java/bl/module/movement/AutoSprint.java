package bl.module.movement;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class AutoSprint extends Module {

    public AutoSprint() {
        super("AutoSprint", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        Object input = Reflect.getField(player, "input");
        Object forward = Reflect.call(input, "hasForwardImpulse");
        Object usingItem = Reflect.call(player, "isUsingItem");
        if (player == null || !Boolean.TRUE.equals(forward) || Boolean.TRUE.equals(usingItem)) {
            return;
        }
        if (!Reflect.invoke(player, "setSprinting", true)) {
            throw new IllegalStateException("Could not enable sprinting");
        }
    }
}
