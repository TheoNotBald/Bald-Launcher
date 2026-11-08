package bl.module.world;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class TreeFeller extends Module {

    private static final int MAX_BLOCKS = 128;
    private final Setting radius = setting(Setting.integer("Tree radius", 5, 2, 8));

    public TreeFeller() {
        super("TreeFeller", Category.WORLD, true);
    }

    @Override
    protected void onTick() {
        Object minecraft = Reflect.instance();
        Object options = Reflect.getField(minecraft, "options");
        Object attack = Reflect.getField(options, "keyAttack");
        if (!Boolean.TRUE.equals(Reflect.call(attack, "isDown"))) {
            return;
        }
        Object hit = Reflect.getField(minecraft, "hitResult");
        if (hit == null || !String.valueOf(Reflect.call(hit, "getType")).equals("BLOCK")) {
            return;
        }
        Object origin = Reflect.call(hit, "getBlockPos");
        Object world = Reflect.world();
        Class<?> blockTags = Types.find("net/minecraft/tags/BlockTags");
        Object logs = blockTags == null ? null : Reflect.call(blockTags, "LOGS");
        if (origin == null || world == null || logs == null) {
            throw new IllegalStateException("Could not resolve the targeted log block");
        }
        ArrayDeque<Object> queue = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        queue.add(origin);
        Object gameMode = Reflect.getField(minecraft, "gameMode");
        Class<?> directionType = Types.find("net/minecraft/core/Direction");
        Object[] directions = directionType == null ? null : directionType.getEnumConstants();
        if (directions == null) {
            throw new IllegalStateException("Could not resolve block directions");
        }
        int broken = 0;
        while (!queue.isEmpty() && broken < MAX_BLOCKS) {
            Object position = queue.removeFirst();
            String key = position.toString();
            if (!visited.add(key) || !withinRadius(origin, position, radius.getInt())) {
                continue;
            }
            Object state = Reflect.call(world, "getBlockState", position);
            if (!Boolean.TRUE.equals(Reflect.call(state, "is", logs))) {
                continue;
            }
            if (!Reflect.invoke(gameMode, "destroyBlock", position)) {
                throw new IllegalStateException("Could not break connected tree log");
            }
            broken++;
            for (Object direction : directions) {
                Object neighbor = Reflect.call(position, "relative", direction);
                if (neighbor != null) {
                    queue.addLast(neighbor);
                }
            }
        }
    }

    private boolean withinRadius(Object origin, Object position, int maxDistance) {
        Object dx = Reflect.call(position, "getX");
        Object dy = Reflect.call(position, "getY");
        Object dz = Reflect.call(position, "getZ");
        Object ox = Reflect.call(origin, "getX");
        Object oy = Reflect.call(origin, "getY");
        Object oz = Reflect.call(origin, "getZ");
        return dx instanceof Number x && dy instanceof Number y && dz instanceof Number z
                && ox instanceof Number baseX && oy instanceof Number baseY && oz instanceof Number baseZ
                && Math.abs(x.intValue() - baseX.intValue()) <= maxDistance
                && Math.abs(y.intValue() - baseY.intValue()) <= maxDistance
                && Math.abs(z.intValue() - baseZ.intValue()) <= maxDistance;
    }
}
