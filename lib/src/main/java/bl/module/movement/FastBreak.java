package bl.module.movement;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class FastBreak extends Module {

    public FastBreak() {
        super("FastBreak", Category.WORLD, true);
    }

    @Override
    protected void onTick() {
        Object minecraft = Reflect.instance();
        Object options = Reflect.getField(minecraft, "options");
        Object attack = Reflect.getField(options, "keyAttack");
        if (!Boolean.TRUE.equals(Reflect.call(attack, "isPressed"))) {
            return;
        }
        Object hit = Reflect.getField(minecraft, "hitResult");
        Object type = Reflect.call(hit, "getType");
        if (hit == null || type == null || !type.toString().equals("BLOCK")) {
            return;
        }
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        if (gameMode == null || !Reflect.setField(gameMode, "destroyDelay", 0)) {
            throw new IllegalStateException("Could not clear the local block-breaking delay");
        }
    }
}
