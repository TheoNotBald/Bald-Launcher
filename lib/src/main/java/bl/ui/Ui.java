package bl.ui;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import bl.mc.RuntimeMappings;
import bl.render.BitmapFont;
import bl.render.GuiRecord;

/**
 * Reflection bridge for the vanilla drawing surface.
 *
 * <p>The agent runs against both the official and the intermediary namespace,
 * so every method is resolved at runtime through the generated mappings and a
 * structural fallback. No Minecraft type is referenced directly here.</p>
 */
final class Ui {

    private final Class<?> graphicsType;
    private final Field fontField;
    private final Object font;
    private final Method fill;
    private final Method fillGradient;
    private final Method shadowText;
    private final Method plainText;
    private final Method fontWidth;
    private final Method enableScissor;
    private final Method disableScissor;
    private final Map<String, Integer> measured = new HashMap<>();
    private boolean recording;

    Ui(Class<?> graphicsType, Field fontField, Object menu) throws ReflectiveOperationException {
        this.graphicsType = graphicsType;
        this.fontField = fontField;
        this.fontField.setAccessible(true);
        this.font = fontField.get(menu);
        this.fill = findFill(graphicsType);
        this.fillGradient = findGradient(graphicsType);
        this.shadowText = findText(graphicsType, fontField.getType(), true);
        this.plainText = findText(graphicsType, fontField.getType(), false);
        if (shadowText == null && plainText == null) {
            throw new NoSuchMethodException("No text drawing method on " + graphicsType.getName());
        }
        this.fontWidth = findFontWidth(fontField.getType());
        this.enableScissor = findScissor(graphicsType, "enableScissor", true);
        this.disableScissor = findScissor(graphicsType, "disableScissor", false);
    }

    void bind(Object menu) throws IllegalAccessException {
        measured.clear();
        // The font handle stays stable for the lifetime of the game instance.
        fontField.get(menu);
    }

    /**
     * While recording, drawing calls become overlay display-list entries instead
     * of touching Minecraft's framebuffer, so nothing of the GUI ends up in a
     * captured game window.
     */
    void recording(boolean value) {
        this.recording = value;
    }

    void fill(Object graphics, int x1, int y1, int x2, int y2, int color) {
        int left = Math.min(x1, x2);
        int right = Math.max(x1, x2);
        int top = Math.min(y1, y2);
        int bottom = Math.max(y1, y2);
        if (right <= left || bottom <= top) {
            return;
        }
        if (recording) {
            GuiRecord.get().fill(left, top, right, bottom, color, color);
            return;
        }
        invoke(fill, graphics, left, top, right, bottom, color);
    }

    void gradient(Object graphics, int x1, int y1, int x2, int y2, int topColor, int bottomColor) {
        if (recording) {
            GuiRecord.get().fill(x1, y1, x2, y2, topColor, bottomColor);
            return;
        }
        if (fillGradient != null) {
            invoke(fillGradient, graphics, Math.min(x1, x2), Math.min(y1, y2),
                    Math.max(x1, x2), Math.max(y1, y2), topColor, bottomColor);
            return;
        }
        int height = Math.max(1, y2 - y1);
        for (int step = 0; step < 12; step++) {
            int bandTop = y1 + height * step / 12;
            int bandBottom = y1 + height * (step + 1) / 12;
            fill(graphics, x1, bandTop, x2, bandBottom,
                    Theme.mix(topColor, bottomColor, (step + 0.5) / 12.0));
        }
    }

    void text(Object graphics, String value, int x, int y, int color) {
        if (value == null || value.isEmpty()) {
            return;
        }
        if (recording) {
            GuiRecord.get().text(value, x, y, color);
            return;
        }
        if (shadowText != null) {
            invoke(shadowText, graphics, font, value, x, y, color);
        } else {
            invoke(plainText, graphics, font, value, x, y, color, false);
        }
    }

    void textCentered(Object graphics, String value, int centerX, int y, int color) {
        text(graphics, value, centerX - width(value) / 2, y, color);
    }

    void textRight(Object graphics, String value, int right, int y, int color) {
        text(graphics, value, right - width(value), y, color);
    }

    int width(String value) {
        if (value == null || value.isEmpty()) {
            return 0;
        }
        if (recording) {
            return Math.round(BitmapFont.width(value, 1.0f));
        }
        Integer cached = measured.get(value);
        if (cached != null) {
            return cached;
        }
        Object result = invoke(fontWidth, font, value);
        int width = result instanceof Number number ? number.intValue() : 0;
        if (measured.size() > 4096) {
            measured.clear();
        }
        measured.put(value, width);
        return width;
    }

    String fit(String value, int maxWidth) {
        if (value == null || maxWidth <= 0) {
            return "";
        }
        if (width(value) <= maxWidth) {
            return value;
        }
        int low = 0;
        int high = value.length();
        while (low < high) {
            int middle = (low + high + 1) >>> 1;
            if (width(value.substring(0, middle) + "...") <= maxWidth) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return low <= 0 ? "" : value.substring(0, low) + "...";
    }

    boolean canScissor() {
        return recording || (enableScissor != null && disableScissor != null);
    }

    void scissor(Object graphics, int x1, int y1, int x2, int y2) {
        if (recording) {
            GuiRecord.get().pushClip(x1, y1, x2, y2);
            return;
        }
        if (!canScissor()) {
            return;
        }
        invoke(enableScissor, graphics, Math.min(x1, x2), Math.min(y1, y2),
                Math.max(x1, x2), Math.max(y1, y2));
    }

    void unscissor(Object graphics) {
        if (recording) {
            GuiRecord.get().popClip();
            return;
        }
        if (canScissor()) {
            invoke(disableScissor, graphics);
        }
    }

    private static Method findFill(Class<?> graphicsType) throws NoSuchMethodException {
        for (Method method : candidates(graphicsType, "fill")) {
            if (method.getReturnType() == void.class
                    && matches(method, int.class, int.class, int.class, int.class, int.class)) {
                return accessible(method);
            }
        }
        throw new NoSuchMethodException("GuiGraphics fill(int,int,int,int,int)");
    }

    private static Method findGradient(Class<?> graphicsType) {
        for (Method method : candidates(graphicsType, "fillGradient")) {
            if (method.getReturnType() == void.class
                    && matches(method, int.class, int.class, int.class, int.class,
                            int.class, int.class)) {
                return accessible(method);
            }
        }
        return null;
    }

    private static Method findText(Class<?> graphicsType, Class<?> fontType, boolean shadow) {
        String preferred = shadow ? "drawTextWithShadow" : "drawText";
        List<String> preferredNames = RuntimeMappings.memberNames(
                graphicsType.getName(), preferred, false);
        List<String> centeredNames = RuntimeMappings.memberNames(
                graphicsType.getName(), "drawCenteredString", false);

        // Prefer the explicitly named left-aligned draw call. Without this,
        // GuiGraphics exposes drawCenteredString with the same descriptor and
        // the structural fallback can pick it, centering every UI string and
        // clipping module names against the column scissor.
        for (Method method : structural(graphicsType)) {
            if (isTextMethod(method, fontType, shadow) && preferredNames.contains(method.getName())) {
                return accessible(method);
            }
        }
        for (Method method : structural(graphicsType)) {
            if (!isTextMethod(method, fontType, shadow)) {
                continue;
            }
            String name = method.getName();
            if (centeredNames.contains(name) || name.toLowerCase(java.util.Locale.ROOT).contains("centered")) {
                continue;
            }
            return accessible(method);
        }
        return null;
    }

    private static boolean isTextMethod(Method method, Class<?> fontType, boolean shadow) {
        Class<?>[] parameters = method.getParameterTypes();
        return method.getReturnType() == void.class && parameters.length >= 5
                && parameters[0] == fontType && parameters[1] == String.class
                && parameters[2] == int.class && parameters[3] == int.class
                && parameters[4] == int.class
                && (shadow ? parameters.length == 5
                        : parameters.length == 6 && parameters[5] == boolean.class);
    }

    private static Method findFontWidth(Class<?> fontType) throws NoSuchMethodException {
        for (Method method : candidates(fontType, "width")) {
            if (method.getReturnType() == int.class && matches(method, String.class)) {
                return accessible(method);
            }
        }
        for (Method method : candidates(fontType, "getWidth")) {
            if (method.getReturnType() == int.class && matches(method, String.class)) {
                return accessible(method);
            }
        }
        for (Method method : structural(fontType)) {
            if (method.getReturnType() == int.class && matches(method, String.class)) {
                return accessible(method);
            }
        }
        throw new NoSuchMethodException(fontType.getName() + "#width(String)");
    }

    private static Method findScissor(Class<?> graphicsType, String named, boolean fourInts) {
        for (Method method : candidates(graphicsType, named)) {
            if (method.getReturnType() == void.class
                    && (fourInts
                            ? matches(method, int.class, int.class, int.class, int.class)
                            : method.getParameterCount() == 0)) {
                return accessible(method);
            }
        }
        for (Method method : structural(graphicsType)) {
            if (method.getReturnType() == void.class && method.getName().equals(named)
                    && (fourInts
                            ? matches(method, int.class, int.class, int.class, int.class)
                            : method.getParameterCount() == 0)) {
                return accessible(method);
            }
        }
        return null;
    }

    private static Iterable<Method> candidates(Class<?> type, String named) {
        List<String> names = RuntimeMappings.memberNames(type.getName(), named, false);
        List<Method> matches = new ArrayList<>();
        for (Method method : structural(type)) {
            if (names.contains(method.getName())) {
                matches.add(method);
            }
        }
        return matches;
    }

    private static Iterable<Method> structural(Class<?> type) {
        List<Method> methods = new ArrayList<>();
        for (Method method : type.getMethods()) {
            if (!Modifier.isStatic(method.getModifiers())) {
                methods.add(method);
            }
        }
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Method method : current.getDeclaredMethods()) {
                if (!Modifier.isStatic(method.getModifiers()) && !methods.contains(method)) {
                    methods.add(method);
                }
            }
        }
        return methods;
    }

    private static boolean matches(Method method, Class<?>... parameters) {
        if (method.getParameterCount() != parameters.length) {
            return false;
        }
        Class<?>[] actual = method.getParameterTypes();
        for (int index = 0; index < parameters.length; index++) {
            if (actual[index] != parameters[index]) {
                return false;
            }
        }
        return true;
    }

    private static Method accessible(Method method) {
        method.setAccessible(true);
        return method;
    }

    private static Object invoke(Method method, Object target, Object... arguments) {
        if (method == null) {
            return null;
        }
        try {
            return method.invoke(target, arguments);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("UI drawing call failed: " + method.getName(), error);
        }
    }

    Class<?> graphicsType() {
        return graphicsType;
    }
}
