package bl.module.player;

import bl.mc.Reflect;
import bl.mc.Types;

final class InventoryActions {

    private InventoryActions() {
    }

    static boolean click(Object player, int slot, int button, String clickTypeName) {
        Object menu = Reflect.getField(player, "containerMenu");
        Object menuId = Reflect.getField(menu, "syncId");
        if (!(menuId instanceof Number)) {
            menuId = Reflect.getField(menu, "containerId");
        }
        Object gameMode = Reflect.getField(Reflect.instance(), "gameMode");
        Class<?> clickTypes = Types.find("net/minecraft/world/inventory/ClickType");
        Object clickType = clickTypes == null ? null : Reflect.call(clickTypes, "valueOf", clickTypeName);
        if (!(menuId instanceof Number id) || clickType == null || gameMode == null) {
            return false;
        }
        return Reflect.invoke(gameMode, "handleInventoryMouseClick", id.intValue(), slot, button, clickType, player);
    }

    static int menuSlotForInventoryIndex(int inventoryIndex) {
        return inventoryIndex < 9 ? inventoryIndex + 36 : inventoryIndex;
    }
}
