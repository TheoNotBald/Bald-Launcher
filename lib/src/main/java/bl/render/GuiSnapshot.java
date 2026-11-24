package bl.render;

/**
 * Immutable display list for the ClickGui when it is drawn in the overlay
 * window. Coordinates are Minecraft GUI pixels; the overlay scales them to its
 * own framebuffer so the window can be resized at any time.
 */
public final class GuiSnapshot {

    public static final GuiSnapshot EMPTY = new GuiSnapshot(0, 0, new Primitive[0]);

    public interface Primitive {
        float clipX0();

        float clipY0();

        float clipX1();

        float clipY1();
    }

    public record Rect(float x0, float y0, float x1, float y1, int top, int bottom,
            float clipX0, float clipY0, float clipX1, float clipY1) implements Primitive {
    }

    public record Text(float x, float y, float scale, int color, String value,
            float clipX0, float clipY0, float clipX1, float clipY1) implements Primitive {
    }

    public final int width;
    public final int height;
    /** In paint order; later primitives sit on top. */
    public final Primitive[] primitives;

    public GuiSnapshot(int width, int height, Primitive[] primitives) {
        this.width = width;
        this.height = height;
        this.primitives = primitives;
    }

    public boolean isEmpty() {
        return width <= 0 || height <= 0 || primitives.length == 0;
    }
}
