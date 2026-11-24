package bl.render;

/**
 * Immutable per-frame hand-off from the game thread to the overlay thread.
 * Nothing in here references a live entity, world or GL object, so the overlay
 * thread can draw it without touching game state.
 */
public final class EspSnapshot {

    public static final EspSnapshot EMPTY = new EspSnapshot(0, 0, new float[0], new int[0], new Label[0]);

    public record Label(float x, float y, float scale, int color, int background, String text) {
    }

    public final int width;
    public final int height;
    /** Five floats per segment: x1, y1, x2, y2, width in pixels. */
    public final float[] segments;
    /** One ARGB colour per segment. */
    public final int[] colors;
    public final Label[] labels;

    public EspSnapshot(int width, int height, float[] segments, int[] colors, Label[] labels) {
        this.width = width;
        this.height = height;
        this.segments = segments;
        this.colors = colors;
        this.labels = labels;
    }

    public int segmentCount() {
        return segments.length / 5;
    }

    public boolean isEmpty() {
        return width <= 0 || height <= 0
                || segmentCount() == 0 && labels.length == 0;
    }
}
