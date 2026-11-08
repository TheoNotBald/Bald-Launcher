package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;

public final class AirJump extends Module {

    public AirJump() {
        super("AirJump", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        Object options = Reflect.getField(Reflect.instance(), "options");
        Object jump = Reflect.getField(options, "keyJump");
        boolean pressed = Boolean.TRUE.equals(Reflect.call(jump, "isDown"));
        if (pressed && !Worlds.onGround(player)) {
            if (!Reflect.invoke(player, "jumpFromGround")) {
                throw new IllegalStateException("Could not trigger the midair jump");
            }
        }
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }
}
