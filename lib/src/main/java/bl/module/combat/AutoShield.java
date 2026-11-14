package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AutoShield extends Module {

    private final Setting range = setting(Setting.decimal("Threat range", 4.0, 2.0, 8.0));
    private int useDelay;

    public AutoShield() {
        super("AutoShield", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        if (useDelay > 0) {
            useDelay--;
            return;
        }
        Object player = Reflect.player();
        Object minecraft = Reflect.instance();
        if (player == null || minecraft == null
                || Reflect.fieldOfType(minecraft, "net/minecraft/client/gui/screens/Screen") != null
                || Boolean.TRUE.equals(Reflect.call(player, "isUsingItem"))) {
            return;
        }
        Object offhandSlot = enumValue("net/minecraft/world/entity/EquipmentSlot", "OFFHAND");
        Object shield = Types.find("net/minecraft/world/item/Items");
        Object shieldItem = shield == null ? null : Reflect.call(shield, "SHIELD");
        Object offhand = Reflect.call(player, "getItemBySlot", offhandSlot);
        if (shieldItem == null || Reflect.call(offhand, "getItem") != shieldItem) {
            return;
        }
        boolean nearbyThreat = false;
        for (Object entity : Worlds.entitiesView()) {
            if (entity != player && Worlds.isMob(entity) && Worlds.alive(entity)
                    && Worlds.distance(player, entity) <= range.getDouble()) {
                nearbyThreat = true;
                break;
            }
        }
        if (!nearbyThreat) {
            return;
        }
        Object hand = enumValue("net/minecraft/world/InteractionHand", "OFF_HAND");
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        if (gameMode == null || !Reflect.invoke(gameMode, "useItem", player, hand)) {
            throw new IllegalStateException("Could not raise the offhand shield");
        }
        useDelay = 10;
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
