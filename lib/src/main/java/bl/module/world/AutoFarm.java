package bl.module.world;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;

public final class AutoFarm extends Module {

    public AutoFarm() {
        super("AutoFarm", Category.WORLD, true);
    }

    @Override
    protected void onTick() {
        Object minecraft = Reflect.instance();
        Object hit = Reflect.getField(minecraft, "hitResult");
        if (hit == null || !String.valueOf(Reflect.call(hit, "getType")).equals("BLOCK")) {
            return;
        }
        Object pos = Reflect.call(hit, "getBlockPos");
        Object state = Reflect.call(Reflect.world(), "getBlockState", pos);
        Object block = Reflect.call(state, "getBlock");
        if (pos == null || state == null || !Types.isInstanceOf(block, "net/minecraft/world/level/block/CropBlock")) {
            return;
        }
        if (!Boolean.TRUE.equals(Reflect.call(block, "isMaxAge", state))) {
            return;
        }
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        if (gameMode == null || !Reflect.invoke(gameMode, "destroyBlock", pos)) {
            throw new IllegalStateException("Could not harvest the mature crop");
        }
    }
}
