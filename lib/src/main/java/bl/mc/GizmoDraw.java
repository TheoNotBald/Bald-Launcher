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

    /** Draws an axis-aligned box given as {@code minX, minY, minZ, maxX, maxY, maxZ}. */
    public static void box(float[] bounds, int color, float width, boolean ignoreOcclusion) {
        box(boxOf(bounds), color, width, ignoreOcclusion);
    }

    public static void line(Object start, Object end, int color, float width, boolean ignoreOcclusion) {
        Object properties = invokeStatic("net/minecraft/world/debug/gizmo/GizmoDrawing",
                "line", start, end, color, width);
        configure(properties, ignoreOcclusion);
    }

    public static void line(float[] points, int color, float width, boolean ignoreOcclusion) {
        line(vector(points[0], points[1], points[2]), vector(points[3], points[4], points[5]),
                color, width, ignoreOcclusion);
    }

    public static void line(double x1, double y1, double z1, double x2, double y2, double z2,
            int color, float width, boolean ignoreOcclusion) {
        line(vector(x1, y1, z1), vector(x2, y2, z2), color, width, ignoreOcclusion);
    }

    /**
     * Plain world-space label above an entity. {@code yOffset} is in 0.25 block
     * steps, matching {@code GizmoDrawing.entityLabel}.
     */
    public static void entityLabel(Object entity, int yOffset, String text, int color,
            float scale, int background) {
        Object properties = Reflect.call(requireType("net/minecraft/world/debug/gizmo/GizmoDrawing"),
                "entityLabel", entity, yOffset, text, color, scale);
        if (properties == null) {
            throw new IllegalStateException("Could not create Minecraft entity label");
        }
        if (!Reflect.invoke(properties, "ignoreOcclusion")) {
            throw new IllegalStateException("Could not configure Minecraft entity label");
        }
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

    private static Object boxOf(float[] bounds) {
        Class<?> boxType = requireType("net/minecraft/util/math/Box");
        try {
            return boxType.getConstructor(double.class, double.class, double.class,
                    double.class, double.class, double.class)
                    .newInstance(bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5]);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not create Minecraft box", error);
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
