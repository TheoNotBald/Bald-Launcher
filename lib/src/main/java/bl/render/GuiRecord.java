package bl.render;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Records the ClickGui's drawing calls instead of pushing them into Minecraft's
 * framebuffer. The ClickGui draws exclusively through {@code bl.ui.Ui}, so this
 * is the whole surface that has to be replayed in the overlay window.
 */
public final class GuiRecord {

    private static final GuiRecord INSTANCE = new GuiRecord();

    public static GuiRecord get() {
        return INSTANCE;
    }

    private final List<GuiSnapshot.Primitive> primitives = new ArrayList<>();
    private final Deque<float[]> clips = new ArrayDeque<>();

    private boolean recording;
    private int width;
    private int height;
    private float clipX0;
    private float clipY0;
    private float clipX1;
    private float clipY1;

    private GuiRecord() {
    }

    public boolean isRecording() {
        return recording;
    }

    public void begin(int guiWidth, int guiHeight) {
        primitives.clear();
        clips.clear();
        width = Math.max(1, guiWidth);
        height = Math.max(1, guiHeight);
        clipX0 = 0.0f;
        clipY0 = 0.0f;
        clipX1 = width;
        clipY1 = height;
        recording = true;
    }

    public GuiSnapshot end() {
        recording = false;
        if (primitives.isEmpty()) {
            return GuiSnapshot.EMPTY;
        }
        return new GuiSnapshot(width, height,
                primitives.toArray(new GuiSnapshot.Primitive[0]));
    }

    public void fill(int x1, int y1, int x2, int y2, int top, int bottom) {
        float left = Math.min(x1, x2);
        float right = Math.max(x1, x2);
        float upper = Math.min(y1, y2);
        float lower = Math.max(y1, y2);
        if (!recording || right <= left || lower <= upper) {
            return;
        }
        primitives.add(new GuiSnapshot.Rect(left, upper, right, lower, top, bottom,
                clipX0, clipY0, clipX1, clipY1));
    }

    public void text(String value, int x, int y, int color) {
        if (!recording || value == null || value.isEmpty()) {
            return;
        }
        // GUI pixels: the built-in font is 6 px per glyph, close to the vanilla
        // font's advance, so the recorded layout stays readable.
        primitives.add(new GuiSnapshot.Text(x, y, 1.0f, color, value,
                clipX0, clipY0, clipX1, clipY1));
    }

    public void pushClip(int x1, int y1, int x2, int y2) {
        if (!recording) {
            return;
        }
        clips.push(new float[] { clipX0, clipY0, clipX1, clipY1 });
        clipX0 = Math.max(clipX0, Math.min(x1, x2));
        clipY0 = Math.max(clipY0, Math.min(y1, y2));
        clipX1 = Math.min(clipX1, Math.max(x1, x2));
        clipY1 = Math.min(clipY1, Math.max(y1, y2));
    }

    public void popClip() {
        if (!recording) {
            return;
        }
        float[] previous = clips.poll();
        if (previous == null) {
            clipX0 = 0.0f;
            clipY0 = 0.0f;
            clipX1 = width;
            clipY1 = height;
            return;
        }
        clipX0 = previous[0];
        clipY0 = previous[1];
        clipX1 = previous[2];
        clipY1 = previous[3];
    }
}
