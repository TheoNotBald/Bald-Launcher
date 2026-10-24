package com.baldlauncher.client;

import java.util.HashMap;
import java.util.Map;

public final class BaldHudLayout {
    public record Position(int x, int y) {}

    private static final Map<String, float[]> LAYOUT = new HashMap<>();
    private static final Map<String, Boolean> LOADED = new HashMap<>();

    private BaldHudLayout() {}

    public static Position getPosition(String id, int screenWidth, int screenHeight, int widgetWidth, int widgetHeight) {
        float[] stored = getStored(id);
        float x = stored == null ? defaultX(id) : stored[0];
        float y = stored == null ? defaultY(id) : stored[1];
        int maxX = Math.max(0, screenWidth - widgetWidth);
        int maxY = Math.max(0, screenHeight - widgetHeight);
        return new Position(Math.round(x * maxX), Math.round(y * maxY));
    }

    public static float getScale(String id) {
        float[] stored = getStored(id);
        return stored == null ? 1.0f : stored[2];
    }

    public static void savePosition(String id, int x, int y, int screenWidth, int screenHeight,
                                    int widgetWidth, int widgetHeight, float scale) throws Exception {
        float normalizedX = screenWidth <= widgetWidth ? 0.0f
                : x / (float) (screenWidth - widgetWidth);
        float normalizedY = screenHeight <= widgetHeight ? 0.0f
                : y / (float) (screenHeight - widgetHeight);
        float clampedScale = Math.max(0.75f, Math.min(2.0f, scale));
        BaldLauncherClient.saveHudWidget(id, normalizedX, normalizedY, clampedScale);
        LAYOUT.put(id, new float[]{Math.max(0, Math.min(1, normalizedX)),
                Math.max(0, Math.min(1, normalizedY)), clampedScale});
        LOADED.put(id, true);
    }

    public static void previewPosition(String id, int x, int y, int screenWidth, int screenHeight,
                                       int widgetWidth, int widgetHeight, float scale) {
        float normalizedX = screenWidth <= widgetWidth ? 0.0f
                : x / (float) (screenWidth - widgetWidth);
        float normalizedY = screenHeight <= widgetHeight ? 0.0f
                : y / (float) (screenHeight - widgetHeight);
        LAYOUT.put(id, new float[]{Math.max(0, Math.min(1, normalizedX)),
                Math.max(0, Math.min(1, normalizedY)), Math.max(0.75f, Math.min(2.0f, scale))});
        LOADED.put(id, true);
    }

    public static void persist(String id) throws Exception {
        float[] stored = getStored(id);
        if (stored != null) {
            BaldLauncherClient.saveHudWidget(id, stored[0], stored[1], stored[2]);
        }
    }

    public static void reset(String id) throws Exception {
        float x = defaultX(id);
        float y = defaultY(id);
        float[] stored = {x, y, 1.0f};
        LAYOUT.put(id, stored);
        LOADED.put(id, true);
        BaldLauncherClient.saveHudWidget(id, x, y, 1.0f);
    }

    private static float[] getStored(String id) {
        if (!LOADED.containsKey(id)) {
            LAYOUT.put(id, BaldLauncherClient.loadHudWidget(id));
            LOADED.put(id, true);
        }
        return LAYOUT.get(id);
    }

    private static float defaultX(String id) {
        if (BaldHudRenderer.IN_GAME_BUTTON_ID.equals(id)) return 0.99f;
        return switch (id) {
            case "cps", "keystrokes" -> 0.82f;
            default -> 0.02f;
        };
    }

    private static float defaultY(String id) {
        if (BaldHudRenderer.IN_GAME_BUTTON_ID.equals(id)) return 0.02f;
        return switch (id) {
            case "frameTime" -> 0.07f;
            case "ping" -> 0.12f;
            case "memory" -> 0.17f;
            case "coordinates" -> 0.23f;
            case "cps" -> 0.03f;
            case "keystrokes" -> 0.09f;
            default -> 0.02f;
        };
    }
}
