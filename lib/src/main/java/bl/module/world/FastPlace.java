package bl.module.world;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class FastPlace extends Module {

    public FastPlace() {
        super("FastPlace", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        Object minecraft = Reflect.instance();
        if (minecraft == null || !Reflect.setField(minecraft, "rightClickDelay", 0)) {
            throw new IllegalStateException("Could not clear the local right-click delay");
        }
    }
}
