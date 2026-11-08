package bl.module.player;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class AutoTool extends Module {

    private Object inventory;
    private int originalSlot = -1;
    private int appliedSlot = -1;

    public AutoTool() {
        super("AutoTool", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        Object minecraft = Reflect.instance();
        Object player = Reflect.player();
        Object options = Reflect.getField(minecraft, "options");
        Object attackKey = Reflect.getField(options, "keyAttack");
        Object pressed = Reflect.call(attackKey, "isDown");
        if (player == null || !Boolean.TRUE.equals(pressed)) {
            restoreSelection();
            return;
        }
        Object hit = Reflect.getField(minecraft, "hitResult");
        Object hitType = Reflect.call(hit, "getType");
        if (hit == null || hitType == null || !hitType.toString().equals("BLOCK")) {
            restoreSelection();
            return;
        }
        Object position = Reflect.call(hit, "getBlockPos");
        Object level = Reflect.world();
        Object state = Reflect.call(level, "getBlockState", position);
        if (position == null || state == null) {
            throw new IllegalStateException("Could not resolve the targeted block");
        }
        Object currentInventory = Reflect.call(player, "getInventory");
        if (currentInventory == null) {
            throw new IllegalStateException("Could not resolve the player inventory");
        }
        if (inventory != null && inventory != currentInventory) {
            clearSelection();
        }
        inventory = currentInventory;
        Object selectedValue = Reflect.call(inventory, "getSelectedSlot");
        if (!(selectedValue instanceof Number selectedNumber)) {
            throw new IllegalStateException("Could not read the selected hotbar slot");
        }
        int selected = selectedNumber.intValue();
        if (appliedSlot >= 0 && selected != appliedSlot) {
            clearSelection();
        }
        selected = selectedNumber.intValue();
        if (appliedSlot == selected) {
            Object appliedStack = Reflect.call(inventory, "getItem", selected);
            if (Boolean.TRUE.equals(Reflect.call(appliedStack, "isCorrectToolForDrops", state))) {
                return;
            }
        }
        Object currentStack = Reflect.call(inventory, "getItem", selected);
        if (Boolean.TRUE.equals(Reflect.call(currentStack, "isCorrectToolForDrops", state))) {
            restoreSelection();
            return;
        }
        for (int slot = 0; slot < 9; slot++) {
            Object stack = Reflect.call(inventory, "getItem", slot);
            if (Boolean.TRUE.equals(Reflect.call(stack, "isCorrectToolForDrops", state))) {
                if (originalSlot < 0) {
                    originalSlot = selected;
                }
                appliedSlot = slot;
                if (!Reflect.invoke(inventory, "setSelectedSlot", slot)) {
                    clearSelection();
                    throw new IllegalStateException("Could not select the correct hotbar tool");
                }
                return;
            }
        }
        restoreSelection();
    }

    @Override
    protected void onDisable() {
        restoreSelection();
    }

    @Override
    protected void onUnavailable() {
        restoreSelection();
    }

    private void restoreSelection() {
        if (inventory != null && originalSlot >= 0) {
            Object selectedValue = Reflect.call(inventory, "getSelectedSlot");
            if (selectedValue instanceof Number selected && selected.intValue() == appliedSlot
                    && !Reflect.invoke(inventory, "setSelectedSlot", originalSlot)) {
                clearSelection();
                throw new IllegalStateException("Could not restore the selected hotbar slot");
            }
        }
        clearSelection();
    }

    private void clearSelection() {
        inventory = null;
        originalSlot = -1;
        appliedSlot = -1;
    }
}
