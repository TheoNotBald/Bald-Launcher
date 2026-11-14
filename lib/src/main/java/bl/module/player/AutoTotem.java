package bl.module.player;

import java.lang.reflect.Constructor;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;

public final class AutoTotem extends Module {

    private static final int OFFHAND_SWAP_BUTTON = 40;
    private static final int PLAYER_INVENTORY_START = 9;
    private static final int PLAYER_INVENTORY_END = 44;

    private Object openedInventory;
    private int retryDelay;

    public AutoTotem() {
        super("AutoTotem", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        if (retryDelay > 0) {
            retryDelay--;
            return;
        }
        Object minecraft = Reflect.instance();
        Object player = Reflect.player();
        if (minecraft == null || player == null) {
            closeOpenedInventory(minecraft);
            return;
        }

        Object totem = totemItem();
        if (totem == null) {
            closeOpenedInventory(minecraft);
            throw new IllegalStateException("Could not resolve the totem item");
        }
        if (offhandHasTotem(player, totem)) {
            closeOpenedInventory(minecraft);
            return;
        }

        Object currentScreen = Reflect.getField(minecraft, "currentScreen");
        if (openedInventory != null && currentScreen != openedInventory) {
            openedInventory = null;
        }
        if (openedInventory == null) {
            // Never replace a screen the player already has open, and do not
            // flash the inventory open when there is no totem to move.
            if (currentScreen != null) {
                return;
            }
            Object currentMenu = Reflect.getField(player, "containerMenu");
            Object currentInventory = Reflect.call(player, "getInventory");
            if (closestTotemSlot(currentMenu, currentInventory, totem) == null) {
                return;
            }
            Object screen = openInventory(minecraft, player);
            if (screen == null) {
                retryDelay = 10;
                return;
            }
            openedInventory = screen;
            return;
        }
        if (currentScreen != openedInventory) {
            openedInventory = null;
            return;
        }

        Object menu = Reflect.getField(player, "containerMenu");
        if (menu == null || !cursorEmpty(menu)) {
            closeOpenedInventory(minecraft);
            retryDelay = 5;
            return;
        }
        Object inventory = Reflect.call(player, "getInventory");
        Object slot = closestTotemSlot(menu, inventory, totem);
        if (slot == null) {
            closeOpenedInventory(minecraft);
            retryDelay = 5;
            return;
        }

        // Mark the totem slot as hovered before sending the offhand swap, matching
        // the normal inventory F-key path without waiting for a mouse event.
        if (!Reflect.setField(openedInventory, "focusedSlot", slot)) {
            closeOpenedInventory(minecraft);
            retryDelay = 10;
            return;
        }
        int slotId = slotId(slot);
        boolean clicked = slotId >= 0
                && InventoryActions.click(player, slotId, OFFHAND_SWAP_BUTTON, "SWAP");
        closeOpenedInventory(minecraft);
        retryDelay = clicked ? 3 : 10;
    }

    @Override
    protected void onDisable() {
        closeOpenedInventory(Reflect.instance());
        retryDelay = 0;
    }

    private Object totemItem() {
        Class<?> items = Types.find("net/minecraft/world/item/Items");
        return items == null ? null : Reflect.call(items, "TOTEM_OF_UNDYING");
    }

    private boolean offhandHasTotem(Object player, Object totem) {
        Object offhand = Reflect.call(player, "getItemBySlot",
                enumValue("net/minecraft/world/entity/EquipmentSlot", "OFFHAND"));
        Object item = Reflect.call(offhand, "getItem");
        return item == totem;
    }

    private Object openInventory(Object minecraft, Object player) {
        try {
            Class<?> screenType = Types.find(
                    "net/minecraft/client/gui/screens/inventory/InventoryScreen");
            if (screenType == null) {
                throw new IllegalStateException("Could not locate the player inventory screen");
            }
            for (Constructor<?> constructor : screenType.getDeclaredConstructors()) {
                if (constructor.getParameterCount() != 1
                        || !constructor.getParameterTypes()[0].isInstance(player)) {
                    continue;
                }
                constructor.setAccessible(true);
                Object screen = constructor.newInstance(player);
                return Reflect.invoke(minecraft, "setScreen", screen) ? screen : null;
            }
            throw new IllegalStateException("Could not find the player inventory screen constructor");
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not open the player inventory", error);
        }
    }

    private Object closestTotemSlot(Object menu, Object inventory, Object totem) {
        Object slots = Reflect.getField(menu, "slots");
        if (!(slots instanceof Iterable<?> slotList) || inventory == null) {
            return null;
        }
        int selected = selectedSlot(inventory);
        Object best = null;
        int bestDistance = Integer.MAX_VALUE;
        for (Object slot : slotList) {
            int id = slotId(slot);
            if (id < PLAYER_INVENTORY_START || id > PLAYER_INVENTORY_END) {
                continue;
            }
            Object stack = Reflect.call(slot, "getStack");
            if (stack == null || Reflect.call(stack, "getItem") != totem) {
                continue;
            }
            int inventoryIndex = id >= 36 ? id - 36 : id;
            int distance = Math.abs(inventoryIndex - selected);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = slot;
            }
        }
        return best;
    }

    private int selectedSlot(Object inventory) {
        Object selected = Reflect.getField(inventory, "selectedSlot");
        if (!(selected instanceof Number)) {
            selected = Reflect.call(inventory, "getSelectedSlot");
        }
        int value = selected instanceof Number number ? number.intValue() : 0;
        return Math.max(0, Math.min(8, value));
    }

    private int slotId(Object slot) {
        Object id = Reflect.getField(slot, "id");
        return id instanceof Number number ? number.intValue() : -1;
    }

    private boolean cursorEmpty(Object menu) {
        Object cursor = Reflect.call(menu, "getCursorStack");
        return cursor == null || Boolean.TRUE.equals(Reflect.call(cursor, "isEmpty"));
    }

    private void closeOpenedInventory(Object minecraft) {
        Object screen = openedInventory;
        openedInventory = null;
        if (screen == null || minecraft == null) {
            return;
        }
        if (Reflect.getField(minecraft, "currentScreen") == screen) {
            Reflect.invoke(minecraft, "setScreen", (Object) null);
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
