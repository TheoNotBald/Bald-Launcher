package bl.mc;

import java.util.function.Consumer;

public final class GizmoDraw {

    private GizmoDraw() {
    }

    public static void inScope(Object levelRenderer, Consumer<Object> drawing) {
        Object scope = Reflect.call(levelRenderer, "startDrawingGizmos");
        if (!(scope instanceof AutoCloseable closeable)) {
            throw new IllegalStateException("Could not start Minecraft gizmo collection");
        }
        try {
            drawing.accept(levelRenderer);
        } finally {
            try {
                closeable.close();
            } catch (Exception error) {
                throw new IllegalStateException("Could not finish Minecraft gizmo collection", error);
            }
        }
    }

    public static void box(Object boundsOrPosition, int color, float width, boolean ignoreOcclusion) {
        Object style = style(color, width);
        Object properties = invokeStatic("net/minecraft/world/debug/gizmo/GizmoDrawing",
                "box", boundsOrPosition, style);
        configure(properties, ignoreOcclusion);
    }

    public static void line(Object start, Object end, int color, float width, boolean ignoreOcclusion) {
        Object properties = invokeStatic("net/minecraft/world/debug/gizmo/GizmoDrawing",
                "line", start, end, color, width);
        configure(properties, ignoreOcclusion);
    }

    public static void entityLabel(Object entity, int color, String text, int background, float scale,
            boolean ignoreOcclusion) {
        Object properties = invokeStatic("net/minecraft/world/debug/gizmo/GizmoDrawing",
                "entityLabel", entity, color, text, background, scale);
        configure(properties, ignoreOcclusion);
    }

    public static Object vector(double x, double y, double z) {
        Class<?> vectorType = requireType("net/minecraft/util/math/Vec3d");
        try {
            return vectorType.getConstructor(double.class, double.class, double.class)
                    .newInstance(x, y, z);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not create Minecraft vector", error);
        }
    }

    private static Object style(int color, float width) {
        Class<?> styleType = requireType("net/minecraft/client/render/DrawStyle");
        Object style = Reflect.call(styleType, "stroked", color, width);
        if (style == null) {
            throw new IllegalStateException("Could not create Minecraft gizmo style");
        }
        return style;
    }

    private static Object invokeStatic(String typeName, String method, Object... args) {
        Object result = Reflect.call(requireType(typeName), method, args);
        if (result == null) {
            throw new IllegalStateException("Could not create Minecraft gizmo: " + method);
        }
        return result;
    }

    private static void configure(Object properties, boolean ignoreOcclusion) {
        if (ignoreOcclusion && !Reflect.invoke(properties, "ignoreOcclusion")) {
            throw new IllegalStateException("Could not configure Minecraft gizmo visibility");
        }
    }

    private static Class<?> requireType(String name) {
        Class<?> type = Types.find(name);
        if (type == null) {
            throw new IllegalStateException("Minecraft type is unavailable: " + name);
        }
        return type;
    }
}
