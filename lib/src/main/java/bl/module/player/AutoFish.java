package bl.module.player;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AutoFish extends Module {

    private final Setting autoCast = setting(Setting.bool("Auto cast", true));
    private int waitTicks;

    public AutoFish() {
        super("AutoFish", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        if (waitTicks > 0) {
            waitTicks--;
            return;
        }
        Object player = Reflect.player();
        if (player == null || Boolean.TRUE.equals(Reflect.call(player, "isUsingItem"))) {
            return;
        }
        Object hook = Reflect.getField(player, "fishing");
        Object nibble = Reflect.getField(hook, "nibble");
        boolean bite = nibble instanceof Number number && number.intValue() > 0;
        Class<?> items = Types.find("net/minecraft/world/item/Items");
        Object fishingRod = items == null ? null : Reflect.call(items, "FISHING_ROD");
        Object hand = enumValue("net/minecraft/world/InteractionHand", "MAIN_HAND");
        Object stack = Reflect.call(player, "getItemInHand", hand);
        if (fishingRod == null || Reflect.call(stack, "getItem") != fishingRod) {
            return;
        }
        if (bite || (hook == null && autoCast.getBool())) {
            Object gameMode = Reflect.getField(Reflect.instance(), "gameMode");
            if (gameMode == null || !Reflect.invoke(gameMode, "useItem", player, hand)) {
                throw new IllegalStateException("Could not use the fishing rod");
            }
            waitTicks = bite ? 20 : 10;
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
