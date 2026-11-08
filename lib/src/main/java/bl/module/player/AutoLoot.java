package bl.module.player;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AutoLoot extends Module {

    private final Setting delay = setting(Setting.integer("Click delay", 2, 1, 10));
    private int ticks;

    public AutoLoot() {
        super("AutoLoot", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        if (++ticks < delay.getInt()) {
            return;
        }
        ticks = 0;
        Object player = Reflect.player();
        Object menu = Reflect.getField(player, "containerMenu");
        if (player == null || menu == null || !menu.getClass().getSimpleName().contains("ChestMenu")) {
            return;
        }
        Object slots = Reflect.getField(menu, "slots");
        Object rowCount = Reflect.getField(menu, "containerRows");
        if (!(slots instanceof Iterable<?> slotList) || !(rowCount instanceof Number rows)) {
            throw new IllegalStateException("Could not read the open chest inventory");
        }
        int chestSlots = rows.intValue() * 9;
        for (Object slot : slotList) {
            Object slotIndex = Reflect.getField(slot, "index");
            if (!(slotIndex instanceof Number index) || index.intValue() >= chestSlots) {
                continue;
            }
            Object stack = Reflect.call(slot, "getItem");
            if (Boolean.TRUE.equals(Reflect.call(stack, "isEmpty"))) {
                continue;
            }
            Object menuId = Reflect.getField(menu, "containerId");
            Object gameMode = Reflect.getField(Reflect.instance(), "gameMode");
            Object clickTypeClass = bl.mc.Types.find("net/minecraft/world/inventory/ClickType");
            Object quickMove = clickTypeClass == null ? null : Reflect.call(clickTypeClass, "valueOf", "QUICK_MOVE");
            if (!(menuId instanceof Number id) || quickMove == null || gameMode == null
                    || !Reflect.invoke(gameMode, "handleInventoryMouseClick", id.intValue(), index.intValue(),
                            0, quickMove, player)) {
                throw new IllegalStateException("Could not transfer chest item");
            }
            return;
        }
    }
}
