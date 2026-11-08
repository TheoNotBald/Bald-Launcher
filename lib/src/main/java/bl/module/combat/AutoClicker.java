package bl.module.combat;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.util.TimerUtil;

public final class AutoClicker extends Module {

    private final TimerUtil timer = new TimerUtil();

    private final Setting cps = setting(Setting.integer("CPS", 11, 8, 16));
    private final Setting pauseInScreens = setting(Setting.bool("Pause in screens", true));

    public AutoClicker() {
        super("AutoClicker", Category.COMBAT);
    }

    @Override
    protected void onTick() {
        Object mc = Reflect.instance();
        if (mc == null) {
            return;
        }
        Object screen = Reflect.fieldOfType(mc, "net/minecraft/client/gui/screens/Screen");
        if (screen != null && pauseInScreens.getBool()) {
            return;
        }
        if (Reflect.player() == null) {
            return;
        }
        int duty = 1000 / cps.getInt();
        if (!timer.passed(duty)) {
            return;
        }
        if (!Reflect.invoke(mc, "startAttack")) {
            throw new IllegalStateException("Could not start an attack click");
        }
        timer.reset();
    }
}
