package bl.module.world;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;

public final class AutoReplant extends Module {

    private int retryDelay;

    public AutoReplant() {
        super("AutoReplant", Category.WORLD, true);
    }

    @Override
    protected void onTick() {
        if (retryDelay > 0) {
            retryDelay--;
            return;
        }
        Object minecraft = Reflect.instance();
        Object hit = Reflect.getField(minecraft, "hitResult");
        if (hit == null || !String.valueOf(Reflect.call(hit, "getType")).equals("BLOCK")) {
            return;
        }
        Object farmlandPos = Reflect.call(hit, "getBlockPos");
        Object world = Reflect.world();
        Object cropPos = Reflect.call(farmlandPos, "above");
        Object state = Reflect.call(world, "getBlockState", cropPos);
        Object air = Reflect.call(state, "isAir");
        if (farmlandPos == null || cropPos == null || world == null || !Boolean.TRUE.equals(air)) {
            return;
        }
        Object blocks = Types.find("net/minecraft/world/level/block/Blocks");
        Object farmland = blocks == null ? null : Reflect.call(blocks, "FARMLAND");
        Object farmlandState = Reflect.call(world, "getBlockState", farmlandPos);
        if (farmland == null || Reflect.call(farmlandState, "getBlock") != farmland) {
            return;
        }
        int seedSlot = findSeeds();
        if (seedSlot < 0) {
            return;
        }
        Object hand = enumValue("net/minecraft/world/InteractionHand", "MAIN_HAND");
        Object direction = enumValue("net/minecraft/core/Direction", "UP");
        Class<?> vecType = Types.find("net/minecraft/world/phys/Vec3");
        Object hitLocation = vecType == null ? null : Reflect.call(vecType, "atCenterOf", farmlandPos);
        Class<?> hitType = Types.find("net/minecraft/world/phys/BlockHitResult");
        Object blockHit = hitType == null ? null : constructHit(hitType, hitLocation, direction, farmlandPos);
        Object player = Reflect.player();
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        Object inventory = Reflect.call(player, "getInventory");
        if (player == null || inventory == null) {
            return;
        }
        Object oldSlot = Reflect.call(inventory, "getSelectedSlot");
        if (!(oldSlot instanceof Number original)
                || blockHit == null || hand == null || gameMode == null) {
            throw new IllegalStateException("Could not prepare to replant the crop");
        }
        if (!Reflect.invoke(inventory, "setSelectedSlot", seedSlot)) {
            throw new IllegalStateException("Could not select seeds");
        }
        try {
            if (!Reflect.invoke(gameMode, "useItemOn", player, hand, blockHit)) {
                throw new IllegalStateException("Could not replant crop");
            }
        } finally {
            if (Reflect.call(inventory, "getSelectedSlot") instanceof Number current
                    && current.intValue() == seedSlot
                    && !Reflect.invoke(inventory, "setSelectedSlot", original.intValue())) {
                throw new IllegalStateException("Could not restore the selected hotbar slot");
            }
        }
        retryDelay = 8;
    }

    private int findSeeds() {
        Object player = Reflect.player();
        Object inventory = Reflect.call(player, "getInventory");
        Class<?> items = Types.find("net/minecraft/world/item/Items");
        String[] names = { "WHEAT_SEEDS", "BEETROOT_SEEDS", "CARROT", "POTATO" };
        for (int slot = 0; slot < 9; slot++) {
            Object stack = Reflect.call(inventory, "getItem", slot);
            Object item = Reflect.call(stack, "getItem");
            for (String name : names) {
                Object candidate = items == null ? null : Reflect.call(items, name);
                if (candidate != null && item == candidate) {
                    return slot;
                }
            }
        }
        return -1;
    }

    private Object constructHit(Class<?> type, Object location, Object direction, Object pos) {
        for (var constructor : type.getConstructors()) {
            if (constructor.getParameterCount() == 4) {
                try {
                    return constructor.newInstance(location, direction, pos, false);
                } catch (ReflectiveOperationException error) {
                    throw new IllegalStateException("Could not create crop placement hit result", error);
                }
            }
        }
        return null;
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
