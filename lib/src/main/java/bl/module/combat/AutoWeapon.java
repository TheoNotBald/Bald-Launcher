package bl.module.combat;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class AutoWeapon extends Module {

    private int originalSlot = -1;
    private int appliedSlot = -1;
    private Object inventory;

    public AutoWeapon() {
        super("AutoWeapon", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        Object options = Reflect.getField(Reflect.instance(), "options");
        Object attack = Reflect.getField(options, "keyAttack");
        if (player == null || !Boolean.TRUE.equals(Reflect.call(attack, "isDown"))) {
            restoreSlot();
            return;
        }
        Object hit = Reflect.getField(Reflect.instance(), "hitResult");
        if (!String.valueOf(Reflect.call(hit, "getType")).equals("ENTITY")) {
            restoreSlot();
            return;
        }
        Object currentInventory = Reflect.call(player, "getInventory");
        Object selectedValue = Reflect.call(currentInventory, "getSelectedSlot");
        if (!(selectedValue instanceof Number selectedNumber)) {
            throw new IllegalStateException("Could not read selected hotbar slot");
        }
        if (inventory != null && inventory != currentInventory) {
            inventory = null;
            originalSlot = -1;
        }
        inventory = currentInventory;
        int selected = selectedNumber.intValue();
        int bestSlot = selected;
        int bestScore = weaponScore(Reflect.call(currentInventory, "getItem", selected));
        for (int slot = 0; slot < 9; slot++) {
            int score = weaponScore(Reflect.call(currentInventory, "getItem", slot));
            if (score > bestScore) {
                bestScore = score;
                bestSlot = slot;
            }
        }
        if (bestSlot == selected) {
            return;
        }
        if (originalSlot < 0) {
            originalSlot = selected;
        }
        if (!Reflect.invoke(currentInventory, "setSelectedSlot", bestSlot)) {
            throw new IllegalStateException("Could not select the best weapon");
        }
        appliedSlot = bestSlot;
    }

    @Override
    protected void onDisable() {
        restoreSlot();
    }

    private int weaponScore(Object stack) {
        Object item = Reflect.call(stack, "getItem");
        if (item == null || Boolean.TRUE.equals(Reflect.call(stack, "isEmpty"))) {
            return 0;
        }
        String itemName = item.toString().toLowerCase(java.util.Locale.ROOT);
        int score = itemName.contains("netherite") ? 8
                : itemName.contains("diamond") ? 7
                : itemName.contains("iron") ? 6
                : itemName.contains("stone") ? 5
                : itemName.contains("golden") ? 4
                : itemName.contains("wooden") ? 3 : 1;
        if (!(itemName.contains("sword") || itemName.contains("axe") || itemName.contains("mace")
                || itemName.contains("trident"))) {
            return 0;
        }
        Object damage = Reflect.call(stack, "getDamageValue");
        Object maxDamage = Reflect.call(stack, "getMaxDamage");
        if (damage instanceof Number damaged && maxDamage instanceof Number maximum && maximum.intValue() > 0) {
            score = score * 1000 - damaged.intValue() * 1000 / maximum.intValue();
        }
        return score;
    }

    private void restoreSlot() {
        if (inventory != null && originalSlot >= 0) {
            Object selected = Reflect.call(inventory, "getSelectedSlot");
            if (selected instanceof Number current && current.intValue() == appliedSlot
                    && !Reflect.invoke(inventory, "setSelectedSlot", originalSlot)) {
                throw new IllegalStateException("Could not restore the selected hotbar slot");
            }
        }
        inventory = null;
        originalSlot = -1;
        appliedSlot = -1;
    }
}
