package bl.module.world;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class SpeedMine extends Module {

    private final Setting breakProgress = setting(Setting.decimal("Break progress", 1.0, 0.5, 1.0));

    public SpeedMine() {
        super("SpeedMine", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        Object minecraft = Reflect.instance();
        Object player = Reflect.player();
        Object options = Reflect.getField(minecraft, "options");
        Object attack = Reflect.getField(options, "keyAttack");
        if (player == null || !Boolean.TRUE.equals(Reflect.call(attack, "isPressed"))) {
            return;
        }
        Object hit = Reflect.getField(minecraft, "hitResult");
        if (hit == null || !String.valueOf(Reflect.call(hit, "getType")).equals("BLOCK")) {
            return;
        }
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        if (!Boolean.TRUE.equals(Reflect.call(gameMode, "isDestroying"))) {
            return;
        }
        if (!Reflect.setField(gameMode, "destroyDelay", 0)
                || !Reflect.setField(gameMode, "destroyProgress", (float) breakProgress.getDouble())) {
            throw new IllegalStateException("Could not accelerate block breaking");
        }
    }
}
