package bl.module.player;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;

public final class AutoTotem extends Module {

    private int retryDelay;

    public AutoTotem() {
        super("AutoTotem", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        if (retryDelay > 0) {
            retryDelay--;
            return;
        }
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        Class<?> items = Types.find("net/minecraft/world/item/Items");
        Object totem = items == null ? null : Reflect.call(items, "TOTEM_OF_UNDYING");
        Object offhand = Reflect.call(player, "getItemBySlot",
                enumValue("net/minecraft/world/entity/EquipmentSlot", "OFFHAND"));
        if (totem == null) {
            throw new IllegalStateException("Could not resolve the totem item");
        }
        if (Reflect.call(offhand, "getItem") == totem) {
            return;
        }
        Object inventory = Reflect.call(player, "getInventory");
        for (int index = 0; index < 36; index++) {
            Object stack = Reflect.call(inventory, "getItem", index);
            if (Reflect.call(stack, "getItem") == totem) {
                if (!InventoryActions.click(player, InventoryActions.menuSlotForInventoryIndex(index), 40, "SWAP")) {
                    throw new IllegalStateException("Could not move a totem into the offhand");
                }
                retryDelay = 10;
                return;
            }
        }
    }

    private Object enumValue(String className, String name) {
        Class<?> type = Types.find(className);
        Object value = type == null ? null : Reflect.call(type, "valueOf", name);
        if (value == null) {
            throw new IllegalStateException("Could not resolve " + className + "." + name);
        }
        return value;
    }
}
