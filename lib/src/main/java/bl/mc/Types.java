package bl.mc;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public final class Types {

    private static final ConcurrentHashMap<String, Optional<Class<?>>> classes = new ConcurrentHashMap<>();

    private Types() {
    }

    public static Class<?> find(String internalName) {
        String normalizedName = internalName.replace('.', '/');
        return classes.computeIfAbsent(normalizedName, Types::load).orElse(null);
    }

    private static Optional<Class<?>> load(String internalName) {
        try {
            String runtimeName = RuntimeMappings.className(internalName);
            ClassLoader loader = RuntimeMappings.gameLoader();
            if (loader == null) {
                loader = Thread.currentThread().getContextClassLoader();
            }
            return Optional.of(Class.forName(runtimeName.replace('/', '.'), true, loader));
        } catch (ClassNotFoundException | LinkageError error) {
            return Optional.empty();
        }
    }

    public static boolean matches(Class<?> type, String internalName) {
        return RuntimeMappings.matchesClass(type, internalName);
    }

    public static boolean isInstanceOf(Object value, String internalName) {
        if (value == null) {
            return false;
        }
        Class<?> targetType = find(internalName);
        return targetType != null && targetType.isAssignableFrom(value.getClass());
    }

    public static Class<?> clipContext() {
        return find("net/minecraft/world/level/ClipContext");
    }

    public static Class<?> entity() {
        return find("net/minecraft/world/entity/Entity");
    }

    public static Class<?> attributes() {
        return find("net/minecraft/world/entity/ai/attributes/Attributes");
    }

    public static Class<?> itemStack() {
        return find("net/minecraft/world/item/ItemStack");
    }
}
