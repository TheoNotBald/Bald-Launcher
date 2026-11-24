package bl.render;

/**
 * One palette for every ESP module, so boxes, tracers and labels share the same
 * colours instead of each module inventing its own.
 */
public final class EspPalette {

    public static final int PLAYER = 0xFF3FA9F5;
    public static final int MOB = 0xFFFF6B6B;
    public static final int ITEM = 0xFFFFD166;
    public static final int TRACER = 0xFF3FA9F5;
    public static final int LABEL_TEXT = 0xFFFFFFFF;
    public static final int LABEL_BACKGROUND = 0x9A000000;

    public static final int ORE_DIAMOND = 0xFF55FFFF;
    public static final int ORE_EMERALD = 0xFF55FF55;
    public static final int ORE_GOLD = 0xFFFFD700;
    public static final int ORE_IRON = 0xFFD8D8D8;
    public static final int ORE_REDSTONE = 0xFFFF4444;
    public static final int ORE_LAPIS = 0xFF5577FF;

    public static final float LINE_WIDTH = 1.5f;
    public static final float LABEL_SCALE = 2.0f;

    private EspPalette() {
    }

    /** Applies a distance fade to the alpha channel of a palette colour. */
    public static int fade(int color, double distance, double maxDistance, float alphaScale) {
        double factor = maxDistance <= 0.0 ? 1.0 : Math.max(0.0, 1.0 - distance / maxDistance);
        int alpha = (int) (((color >>> 24) & 0xFF) * factor * alphaScale);
        if (alpha <= 0) {
            return 0;
        }
        return (alpha << 24) | (color & 0xFFFFFF);
    }
}
