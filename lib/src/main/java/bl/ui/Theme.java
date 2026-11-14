package bl.ui;

import bl.module.Category;

/**
 * Palette and colour helpers for the in-game module interface.
 *
 * <p>The accent is Meteor's purple ({@code #913DE2}); the columns use a
 * near-black translucent body with white/light-grey text, matching the
 * reference ClickGUI rather than the old teal dashboard.</p>
 */
final class Theme {

    private Theme() {
    }

    static final int BACKDROP_TOP = 0xB00B0612;
    static final int BACKDROP_BOTTOM = 0xE0030208;
    static final int BOARD_SHADOW = 0x88000000;
    static final int SHADOW = 0x99000000;

    static final int COLUMN = 0xD014111A;
    static final int PANEL = 0xF0100C16;
    static final int PANEL_EDGE = 0xFF4A2A63;
    static final int HEADER_TOP = 0xFFAA55F2;
    static final int HEADER_BOTTOM = 0xFF7D2AC7;

    static final int ACCENT = 0xFF913DE2;
    static final int ACCENT_LIGHT = 0xFFB66CFF;
    static final int ACCENT_DARK = 0xFF5E1A96;

    static final int ROW_ACTIVE = 0xCC35303D;
    static final int ROW_HOVER = 0x662E1A46;
    static final int ROW_LINE = 0x331A1024;

    static final int SETTING_BG = 0xCC1B1424;
    static final int SETTING_HOVER = 0xCC2A1B39;
    static final int TOAST = 0xF0161020;
    static final int MODAL_SCRIM = 0xB3000000;

    static final int TEXT = 0xFFFFFFFF;
    static final int TEXT_SOFT = 0xFFD7D0E0;
    static final int TEXT_MUTED = 0xFF969696;
    static final int TEXT_DIM = 0xFF6A6470;
    static final int LINE = 0xFF3B244D;
    static final int LINE_SOFT = 0xFF261A31;

    static final int OK = ACCENT;
    static final int WARN = 0xFFF7C948;
    static final int DANGER = 0xFFFF6B7A;

    static int category(Category category) {
        // Meteor uses one accent colour for every window header.
        return ACCENT;
    }

    static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | ((alpha & 0xFF) << 24);
    }

    static int alpha(int color, double factor) {
        int base = (color >>> 24) & 0xFF;
        int value = (int) Math.round(base * Math.max(0.0, Math.min(1.0, factor)));
        return withAlpha(color, value);
    }

    static int lighten(int color, int amount) {
        int red = Math.min(255, ((color >>> 16) & 0xFF) + amount);
        int green = Math.min(255, ((color >>> 8) & 0xFF) + amount);
        int blue = Math.min(255, (color & 0xFF) + amount);
        return (color & 0xFF000000) | (red << 16) | (green << 8) | blue;
    }

    static int mix(int first, int second, double factor) {
        double t = Math.max(0.0, Math.min(1.0, factor));
        int red = (int) Math.round(((first >>> 16) & 0xFF) * (1.0 - t) + ((second >>> 16) & 0xFF) * t);
        int green = (int) Math.round(((first >>> 8) & 0xFF) * (1.0 - t) + ((second >>> 8) & 0xFF) * t);
        int blue = (int) Math.round((first & 0xFF) * (1.0 - t) + (second & 0xFF) * t);
        int alphaFirst = (first >>> 24) & 0xFF;
        int alphaSecond = (second >>> 24) & 0xFF;
        int alpha = (int) Math.round(alphaFirst * (1.0 - t) + alphaSecond * t);
        return (alpha << 24) | (red << 16) | (green << 8) | blue;
    }
}
