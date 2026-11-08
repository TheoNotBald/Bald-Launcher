package bl.module.player;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;

public final class AutoArmor extends Module {

    private int clickDelay;

    public AutoArmor() {
        super("AutoArmor", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        if (clickDelay > 0) {
            clickDelay--;
            return;
        }
        Object player = Reflect.player();
        if (player == null || Reflect.fieldOfType(Reflect.instance(), "net/minecraft/client/gui/screens/Screen") != null) {
            return;
        }
        Class<?> components = Types.find("net/minecraft/core/component/DataComponents");
        Class<?> equipmentSlot = Types.find("net/minecraft/world/entity/EquipmentSlot");
        Object equippableComponent = components == null ? null : Reflect.call(components, "EQUIPPABLE");
        if (equippableComponent == null || equipmentSlot == null) {
            throw new IllegalStateException("Could not resolve armor equipment components");
        }
        Object inventory = Reflect.call(player, "getInventory");
        for (int index = 0; index < 36; index++) {
            Object stack = Reflect.call(inventory, "getItem", index);
            Object component = Reflect.call(stack, "get", equippableComponent);
            if (component == null) {
                continue;
            }
            Object slot = Reflect.call(component, "slot");
            if (slot == null || !Boolean.TRUE.equals(Reflect.call(slot, "isArmor"))) {
                continue;
            }
            Object worn = Reflect.call(player, "getItemBySlot", slot);
            if (worn == null || !Boolean.TRUE.equals(Reflect.call(worn, "isEmpty"))) {
                continue;
            }
            if (!InventoryActions.click(player, InventoryActions.menuSlotForInventoryIndex(index), 0, "QUICK_MOVE")) {
                throw new IllegalStateException("Could not equip armor from inventory slot " + index);
            }
            clickDelay = 5;
            return;
        }
    }
}
