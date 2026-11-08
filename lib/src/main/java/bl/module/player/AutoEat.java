package bl.module.player;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AutoEat extends Module {

    private final Setting hunger = setting(Setting.integer("Hunger threshold", 14, 1, 19));

    public AutoEat() {
        super("AutoEat", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        Object foodData = Reflect.call(player, "getFoodData");
        Object foodLevel = Reflect.call(foodData, "getFoodLevel");
        if (!(foodLevel instanceof Number food) || food.intValue() > hunger.getInt()) {
            return;
        }
        Object usingItem = Reflect.call(player, "isUsingItem");
        if (Boolean.TRUE.equals(usingItem)) {
            return;
        }
        Class<?> hands = Types.find("net/minecraft/world/InteractionHand");
        Class<?> components = Types.find("net/minecraft/core/component/DataComponents");
        if (hands == null || components == null) {
            throw new IllegalStateException("Could not resolve food-use Minecraft types");
        }
        Object mainHand = Reflect.call(hands, "MAIN_HAND");
        Object offHand = Reflect.call(hands, "OFF_HAND");
        Object foodComponent = Reflect.call(components, "FOOD");
        if (mainHand == null || offHand == null || foodComponent == null) {
            throw new IllegalStateException("Could not resolve food item component");
        }
        Object stack = Reflect.call(player, "getItemInHand", mainHand);
        Object component = Reflect.call(stack, "get", foodComponent);
        Object hand = mainHand;
        if (component == null) {
            stack = Reflect.call(player, "getItemInHand", offHand);
            component = Reflect.call(stack, "get", foodComponent);
            hand = offHand;
        }
        if (component == null) {
            return;
        }
        Object minecraft = Reflect.instance();
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        if (gameMode == null || !Reflect.invoke(gameMode, "useItem", player, hand)) {
            throw new IllegalStateException("Could not start eating the selected food");
        }
    }
}
