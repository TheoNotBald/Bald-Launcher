package bl.mc;

import java.util.ArrayList;
import java.util.List;

public final class Worlds {

    private Worlds() {
    }

    public static List<Object> entities() {
        List<Object> out = new ArrayList<>();
        for (Object entity : entitiesView()) {
            out.add(entity);
        }
        return out;
    }

    public static Iterable<?> entitiesView() {
        Object world = Reflect.world();
        if (world == null) {
            return List.of();
        }
        Object listed = Reflect.call(world, "getEntities");
        if (!(listed instanceof Iterable<?>)) {
            listed = Reflect.call(world, "entitiesForRendering");
        }
        if (!(listed instanceof Iterable<?> iterable)) {
            return List.of();
        }
        return iterable;
    }

    public static double distance(Object from, Object to) {
        double squared = distanceSquared(from, to);
        return Double.isFinite(squared) ? Math.sqrt(squared) : Double.POSITIVE_INFINITY;
    }

    public static double distanceSquared(Object from, Object to) {
        double dx = coordinate(to, "getX", "x") - coordinate(from, "getX", "x");
        double dy = coordinate(to, "getY", "y") - coordinate(from, "getY", "y");
        double dz = coordinate(to, "getZ", "z") - coordinate(from, "getZ", "z");
        return dx * dx + dy * dy + dz * dz;
    }

    public static double coordinate(Object entity, String accessor, String field) {
        Object value = Reflect.call(entity, accessor);
        if (!(value instanceof Number)) {
            value = Reflect.getField(entity, field);
        }
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.NaN;
    }

    public static float health(Object entity) {
        Object value = Reflect.call(entity, "getHealth");
        return value instanceof Number number ? number.floatValue() : 20.0f;
    }

    public static boolean alive(Object entity) {
        Object dead = Reflect.call(entity, "isAlive");
        return dead instanceof Boolean alive && alive;
    }

    public static double fallDistance(Object entity) {
        Object value = Reflect.getField(entity, "fallDistance");
        if (!(value instanceof Number)) {
            value = Reflect.call(entity, "getFallDistance");
        }
        return value instanceof Number number && Double.isFinite(number.doubleValue())
                ? number.doubleValue()
                : Double.NaN;
    }

    public static double verticalVelocity(Object entity) {
        Object movement = Reflect.call(entity, "getVelocity");
        if (movement == null) {
            movement = Reflect.call(entity, "getDeltaMovement");
        }
        Object value = Reflect.getField(movement, "y");
        if (!(value instanceof Number)) {
            value = Reflect.call(movement, "y");
        }
        return value instanceof Number number && Double.isFinite(number.doubleValue())
                ? number.doubleValue()
                : Double.NaN;
    }

    public static boolean isPlayer(Object entity) {
        return Types.isInstanceOf(entity, "net/minecraft/world/entity/player/Player");
    }

    public static boolean isMob(Object entity) {
        return Types.isInstanceOf(entity, "net/minecraft/world/entity/Mob");
    }

    public static boolean isHostileMob(Object entity) {
        return Types.isInstanceOf(entity, "net/minecraft/world/entity/monster/Monster");
    }

    public static boolean isItem(Object entity) {
        return Types.isInstanceOf(entity, "net/minecraft/world/entity/item/ItemEntity");
    }

    public static boolean inLiquid(Object entity) {
        Object value = Reflect.call(entity, "isInWater");
        return value instanceof Boolean bool && bool;
    }

    public static boolean onGround(Object entity) {
        Object value = Reflect.call(entity, "isOnGround");
        if (!(value instanceof Boolean)) {
            value = Reflect.call(entity, "onGround");
        }
        if (!(value instanceof Boolean)) {
            value = Reflect.getField(entity, "onGround");
        }
        return value instanceof Boolean bool && bool;
    }

    /**
     * Reads a block state with a chunk-level fallback. ClientLevel can expose
     * getBlockState through an interface rather than a declared method, and a
     * single failed reflective lookup must not disable a movement module.
     */
    public static Object blockState(Object world, double x, double y, double z) {
        if (world == null) {
            return null;
        }
        Class<?> blockPosType = Types.find("net/minecraft/core/BlockPos");
        if (blockPosType == null) {
            return null;
        }
        Object pos = Reflect.call(blockPosType, "containing", x, y, z);
        if (pos == null) {
            return null;
        }
        Object state = Reflect.call(world, "getBlockState", pos);
        if (state != null) {
            return state;
        }
        Object chunk = Reflect.call(world, "getChunk", pos);
        if (chunk == null) {
            chunk = Reflect.call(world, "getChunk",
                    (int) Math.floor(x) >> 4, (int) Math.floor(z) >> 4);
        }
        return chunk == null ? null : Reflect.call(chunk, "getBlockState", pos);
    }

    /** Collision-shape test for a world position; unreadable positions read as air. */
    public static boolean solid(Object world, double x, double y, double z) {
        Object state = blockState(world, x, y, z);
        if (state == null) {
            return false;
        }
        Class<?> blockPosType = Types.find("net/minecraft/core/BlockPos");
        Object pos = blockPosType == null ? null : Reflect.call(blockPosType, "containing", x, y, z);
        if (pos == null) {
            return false;
        }
        Object shape = Reflect.call(state, "getCollisionShape", world, pos);
        if (shape != null) {
            Object empty = Reflect.call(shape, "isEmpty");
            if (empty instanceof Boolean isEmpty) {
                return !isEmpty;
            }
        }
        Object solid = Reflect.call(state, "isSolid");
        return solid instanceof Boolean isSolid && isSolid;
    }

    public static boolean cobweb(Object world, double x, double y, double z) {
        Object state = blockState(world, x, y, z);
        if (state == null) {
            return false;
        }
        return Types.isInstanceOf(Reflect.call(state, "getBlock"), "net/minecraft/block/CobwebBlock");
    }

    public static String displayName(Object entity) {
        Object name = Reflect.call(entity, "getName");
        Object text = name == null ? null : Reflect.call(name, "getString");
        return text instanceof String string ? string : entity.getClass().getSimpleName();
    }

    public static void swingMainHand(Object player) {
        Class<?> interactionHand = Types.find("net/minecraft/world/InteractionHand");
        Object mainHand = interactionHand == null ? null : Reflect.call(interactionHand, "MAIN_HAND");
        if (mainHand == null || !Reflect.invoke(player, "swing", mainHand)) {
            throw new IllegalStateException("Could not swing the main hand");
        }
    }
}
