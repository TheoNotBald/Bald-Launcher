package bl.module.world;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class AutoMine extends Module {

    public AutoMine() {
        super("AutoMine", Category.WORLD, true);
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
        if (hit == null || !String.valueOf(Reflect.call(hit, "getType")).equals("BLOCK")) {
            return;
        }
        Object pos = Reflect.call(hit, "getBlockPos");
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        if (pos == null || gameMode == null || !Reflect.invoke(gameMode, "destroyBlock", pos)) {
            throw new IllegalStateException("Could not mine the targeted block");
        }
    }
}
