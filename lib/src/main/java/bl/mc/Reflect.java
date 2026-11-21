package bl.mc;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import bl.Bl;

public final class Reflect {

    private record MethodKey(Class<?> owner, String name, boolean staticTarget, List<Class<?>> arguments) {
    }

    private record FieldKey(Class<?> owner, String name) {
    }

    private record TypedFieldKey(Class<?> owner, String typeName) {
    }

    private static final class NullArgument {
    }

    private static final ConcurrentHashMap<MethodKey, Optional<Method>> methods = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<FieldKey, Optional<Field>> fields = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<TypedFieldKey, Optional<Field>> typedFields = new ConcurrentHashMap<>();

    private static Object cachedMinecraft;
    private static volatile Method setYaw;
    private static volatile Method setPitch;
    private static volatile Method getYaw;
    private static volatile Method getPitch;
    private static volatile Class<?> rotationOwner;
    private static volatile float cachedSensitivity = 0.5f;
    private static volatile long sensitivityUpdatedAt;

    private Reflect() {
    }

    public static Object instance() {
        if (cachedMinecraft != null) {
            return cachedMinecraft;
        }
        try {
            Class<?> type = Types.find("net/minecraft/client/Minecraft");
            if (type == null) {
                return null;
            }
            for (Method method : type.getDeclaredMethods()) {
                if (Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 0
                        && method.getReturnType() == type) {
                    method.setAccessible(true);
                    cachedMinecraft = method.invoke(null);
                    return cachedMinecraft;
                }
            }
        } catch (Throwable t) {
            Bl.fault(t);
        }
        return null;
    }

    public static Object fieldOfType(Object target, String internalName) {
        if (target == null) {
            return null;
        }
        Class<?> owner = target.getClass();
        TypedFieldKey key = new TypedFieldKey(owner, internalName.replace('.', '/'));
        Optional<Field> field = typedFields.computeIfAbsent(key, Reflect::findFieldByType);
        if (field.isEmpty()) {
            return null;
        }
        try {
            return field.get().get(target);
        } catch (IllegalAccessException error) {
            Bl.fault(error);
            return null;
        }
    }

    public static Object call(Object target, String name, Object... args) {
        if (target == null || name == null) {
            return null;
        }
        boolean staticTarget = target instanceof Class<?>;
        Class<?> type = staticTarget ? (Class<?>) target : target.getClass();
        Optional<Method> selected = resolveMethod(type, name, staticTarget, args);
        if (selected.isPresent()) {
            try {
                return selected.get().invoke(staticTarget ? null : target, args);
            } catch (ReflectiveOperationException error) {
                Bl.fault(error);
                return null;
            }
        }
        if (staticTarget && args.length == 0) {
            Optional<Field> field = resolveField(type, name);
            if (field.isPresent() && Modifier.isStatic(field.get().getModifiers())) {
                try {
                    return field.get().get(null);
                } catch (IllegalAccessException error) {
                    Bl.fault(error);
                }
            }
        }
        return null;
    }

    public static boolean invoke(Object target, String name, Object... args) {
        if (target == null || name == null) {
            return false;
        }
        boolean staticTarget = target instanceof Class<?>;
        Class<?> type = staticTarget ? (Class<?>) target : target.getClass();
        Optional<Method> selected = resolveMethod(type, name, staticTarget, args);
        if (selected.isEmpty()) {
            return false;
        }
        try {
            selected.get().invoke(staticTarget ? null : target, args);
            return true;
        } catch (ReflectiveOperationException error) {
            Bl.fault(error);
            return false;
        }
    }

    public static boolean setField(Object target, String name, Object value) {
        if (target == null || name == null) {
            return false;
        }
        Optional<Field> field = resolveField(target.getClass(), name);
        if (field.isEmpty()) {
            return false;
        }
        try {
            field.get().set(target, value);
            return true;
        } catch (ReflectiveOperationException error) {
            Bl.fault(error);
            return false;
        }
    }

    public static Object getField(Object target, String name) {
        if (target == null || name == null) {
            return null;
        }
        Optional<Field> field = resolveField(target.getClass(), name);
        if (field.isEmpty()) {
            return null;
        }
        try {
            return field.get().get(target);
        } catch (ReflectiveOperationException error) {
            Bl.fault(error);
            return null;
        }
    }

    /**
     * Reads the first field that exists. Minecraft 1.21.11 has both official
     * and Yarn names for several client members, and the runtime namespace is
     * not always known when a module is written.
     */
    public static Object getFieldAny(Object target, String... names) {
        for (String name : names) {
            Object value = getField(target, name);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    public static boolean setFieldAny(Object target, Object value, String... names) {
        for (String name : names) {
            if (setField(target, name, value)) {
                return true;
            }
        }
        return false;
    }

    public static boolean invokeAny(Object target, String... names) {
        for (String name : names) {
            if (invoke(target, name)) {
                return true;
            }
        }
        return false;
    }

    private static Optional<Method> resolveMethod(Class<?> type, String name, boolean staticTarget, Object[] args) {
        List<Class<?>> argumentTypes = new ArrayList<>(args.length);
        for (Object argument : args) {
            argumentTypes.add(argument == null ? NullArgument.class : argument.getClass());
        }
        MethodKey key = new MethodKey(type, name, staticTarget, argumentTypes);
        return methods.computeIfAbsent(key, ignored -> findMethod(type, name, staticTarget, args));
    }

    private static Optional<Method> findMethod(Class<?> type, String name, boolean staticTarget, Object[] args) {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (String candidateName : RuntimeMappings.memberNames(current.getName(), name, false)) {
                Method selected = null;
                int selectedCost = Integer.MAX_VALUE;
                for (Method method : current.getDeclaredMethods()) {
                    if (!method.getName().equals(candidateName)
                            || Modifier.isStatic(method.getModifiers()) != staticTarget) {
                        continue;
                    }
                    int cost = compatibilityCost(method.getParameterTypes(), args);
                    if (cost < selectedCost) {
                        selected = method;
                        selectedCost = cost;
                    }
                }
                if (selected != null) {
                    selected.setAccessible(true);
                    return Optional.of(selected);
                }
            }
        }
        Method selected = null;
        int selectedCost = Integer.MAX_VALUE;
        for (Method method : type.getMethods()) {
            if (Modifier.isStatic(method.getModifiers()) != staticTarget
                    || !RuntimeMappings.memberNames(method.getDeclaringClass().getName(), name, false)
                            .contains(method.getName())) {
                continue;
            }
            int cost = compatibilityCost(method.getParameterTypes(), args);
            if (cost < selectedCost) {
                selected = method;
                selectedCost = cost;
            }
        }
        if (selected != null) {
            selected.setAccessible(true);
            return Optional.of(selected);
        }
        return Optional.empty();
    }

    private static Optional<Field> resolveField(Class<?> type, String name) {
        FieldKey key = new FieldKey(type, name);
        return fields.computeIfAbsent(key, ignored -> findField(type, name));
    }

    private static Optional<Field> findField(Class<?> type, String name) {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (String candidateName : RuntimeMappings.memberNames(current.getName(), name, true)) {
                try {
                    Field field = current.getDeclaredField(candidateName);
                    field.setAccessible(true);
                    return Optional.of(field);
                } catch (NoSuchFieldException ignored) {
                    // Try the next mapping alias.
                }
            }
        }
        return Optional.empty();
    }

    private static Optional<Field> findFieldByType(TypedFieldKey key) {
        for (Class<?> current = key.owner(); current != null; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                if (Types.matches(field.getType(), key.typeName())) {
                    field.setAccessible(true);
                    return Optional.of(field);
                }
            }
        }
        return Optional.empty();
    }

    private static int compatibilityCost(Class<?>[] parameters, Object[] args) {
        if (parameters.length != args.length) {
            return Integer.MAX_VALUE;
        }
        int total = 0;
        for (int index = 0; index < parameters.length; index++) {
            Object argument = args[index];
            Class<?> parameter = parameters[index];
            if (argument == null) {
                if (parameter.isPrimitive()) return Integer.MAX_VALUE;
                continue;
            }
            if (parameter.isAssignableFrom(argument.getClass())) {
                total += parameter == argument.getClass() ? 0 : 1;
                continue;
            }
            int conversion = primitiveWideningCost(parameter, argument);
            if (conversion == Integer.MAX_VALUE) {
                return conversion;
            }
            total += conversion;
        }
        return total;
    }

    private static int primitiveWideningCost(Class<?> target, Object value) {
        if (target == boolean.class) {
            return value instanceof Boolean ? 0 : Integer.MAX_VALUE;
        }
        if (target == char.class) {
            return value instanceof Character ? 0 : Integer.MAX_VALUE;
        }
        if (value instanceof Character) {
            return switch (target.getName()) {
                case "int" -> 1;
                case "long" -> 2;
                case "float" -> 3;
                case "double" -> 4;
                default -> Integer.MAX_VALUE;
            };
        }
        if (!(value instanceof Number)) {
            return Integer.MAX_VALUE;
        }
        Class<?> source = value instanceof Byte ? byte.class
                : value instanceof Short ? short.class
                : value instanceof Integer ? int.class
                : value instanceof Long ? long.class
                : value instanceof Float ? float.class
                : value instanceof Double ? double.class
                : null;
        if (source == null || !target.isPrimitive()) {
            return Integer.MAX_VALUE;
        }
        if (source == target) {
            return 0;
        }
        if (source == byte.class) {
            return switch (target.getName()) {
                case "short" -> 1;
                case "int" -> 2;
                case "long" -> 3;
                case "float" -> 4;
                case "double" -> 5;
                default -> Integer.MAX_VALUE;
            };
        }
        if (source == short.class) {
            return switch (target.getName()) {
                case "int" -> 1;
                case "long" -> 2;
                case "float" -> 3;
                case "double" -> 4;
                default -> Integer.MAX_VALUE;
            };
        }
        if (source == int.class) {
            return switch (target.getName()) {
                case "long" -> 1;
                case "float" -> 2;
                case "double" -> 3;
                default -> Integer.MAX_VALUE;
            };
        }
        if (source == long.class) {
            return switch (target.getName()) {
                case "float" -> 1;
                case "double" -> 2;
                default -> Integer.MAX_VALUE;
            };
        }
        if (source == float.class && target == double.class) {
            return 1;
        }
        return Integer.MAX_VALUE;
    }

    public static Object player() {
        return fieldOfType(instance(), "net/minecraft/client/player/LocalPlayer");
    }

    public static Object world() {
        Object mc = instance();
        Object level = fieldOfType(mc, "net/minecraft/client/multiplayer/ClientLevel");
        return level != null ? level : fieldOfType(mc, "net/minecraft/world/level/Level");
    }

    public static Object connectionOf(Object listener) {
        return fieldOfType(listener, "net/minecraft/network/Connection");
    }

    public static boolean isChat(Object packet) {
        return packet != null && packet.getClass().getName().contains("ServerboundChat");
    }

    public static String chatText(Object packet) {
        if (packet == null) {
            return null;
        }
        for (Method method : packet.getClass().getDeclaredMethods()) {
            if (method.getParameterCount() == 0 && method.getReturnType() == String.class) {
                try {
                    method.setAccessible(true);
                    return (String) method.invoke(packet);
                } catch (Throwable ignored) {
                    // try next
                }
            }
        }
        return null;
    }

    private static void bindRotation() {
        Object player = player();
        if (player == null || rotationOwner == player.getClass()) {
            return;
        }
        Class<?> type = player.getClass();
        getYaw = resolveMethod(type, "getYRot", false, new Object[0]).orElse(null);
        setYaw = resolveMethod(type, "setYRot", false, new Object[] { 0.0f }).orElse(null);
        getPitch = resolveMethod(type, "getXRot", false, new Object[0]).orElse(null);
        setPitch = resolveMethod(type, "setXRot", false, new Object[] { 0.0f }).orElse(null);
        rotationOwner = type;
        if (getYaw == null || setYaw == null || getPitch == null || setPitch == null) {
            Bl.reportFailure("Rotation binding", new NoSuchMethodException(
                    "Could not resolve LocalPlayer getYRot/setYRot/getXRot/setXRot"));
        }
    }

    public static void applyRotation(float yaw, float pitch) {
        Object player = player();
        if (player == null) {
            return;
        }
        bindRotation();
        try {
            if (setYaw != null) {
                setYaw.invoke(player, yaw);
            }
            if (setPitch != null) {
                setPitch.invoke(player, pitch);
            }
        } catch (Throwable t) {
            Bl.fault(t);
        }
    }

    public static float yaw() {
        Object player = player();
        if (player == null) {
            return 0.0f;
        }
        bindRotation();
        try {
            return getYaw == null ? 0.0f : (float) getYaw.invoke(player);
        } catch (Throwable t) {
            return 0.0f;
        }
    }

    public static float pitch() {
        Object player = player();
        if (player == null) {
            return 0.0f;
        }
        bindRotation();
        try {
            return getPitch == null ? 0.0f : (float) getPitch.invoke(player);
        } catch (Throwable t) {
            return 0.0f;
        }
    }

    public static double posX() {
        Object player = player();
        return player == null ? 0.0 : coordinate(player, 0);
    }

    public static double posY() {
        Object player = player();
        return player == null ? 0.0 : coordinate(player, 1);
    }

    public static double posZ() {
        Object player = player();
        return player == null ? 0.0 : coordinate(player, 2);
    }

    private static double coordinate(Object entity, int index) {
        String accessor = switch (index) {
            case 0 -> "getX";
            case 1 -> "getY";
            default -> "getZ";
        };
        Object value = call(entity, accessor);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        int seen = 0;
        Class<?> type = entity.getClass();
        while (type != null) {
            for (Field field : type.getDeclaredFields()) {
                if (field.getType() == double.class && !Modifier.isStatic(field.getModifiers())) {
                    if (seen++ == index) {
                        try {
                            field.setAccessible(true);
                            return field.getDouble(entity);
                        } catch (Throwable t) {
                            return 0.0;
                        }
                    }
                }
            }
            type = type.getSuperclass();
        }
        return 0.0;
    }

    public static Object eyePosition() {
        Object player = player();
        if (player == null) {
            return null;
        }
        try {
            for (Method method : player.getClass().getMethods()) {
                if (method.getParameterCount() == 0 && method.getReturnType().getSimpleName().equals("Vec3")) {
                    return method.invoke(player);
                }
            }
        } catch (Throwable t) {
            Bl.fault(t);
        }
        return null;
    }

    public static float sensitivity() {
        long now = System.currentTimeMillis();
        if (now - sensitivityUpdatedAt < 500) {
            return cachedSensitivity;
        }
        Object options = fieldOfType(instance(), "net/minecraft/client/Options");
        if (options == null) {
            return cachedSensitivity;
        }
        Object option = call(options, "sensitivity");
        Object value = call(option, "get");
        if (value instanceof Number number && number.doubleValue() >= 0.0 && number.doubleValue() <= 1.0) {
            cachedSensitivity = number.floatValue();
            sensitivityUpdatedAt = now;
            return cachedSensitivity;
        }
        if (sensitivityUpdatedAt == 0) {
            sensitivityUpdatedAt = now;
        }
        return cachedSensitivity;
    }
}
