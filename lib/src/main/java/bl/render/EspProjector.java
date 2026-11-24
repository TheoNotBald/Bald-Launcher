package bl.render;

/**
 * Projects world positions into framebuffer pixels using the exact
 * view/projection pair the game used for the frame.
 *
 * <p>Clipping happens in homogeneous space: segments that cross the near plane
 * are shortened instead of producing inverted, screen-covering lines, which is
 * what a naive divide by {@code w} does for geometry behind the camera.</p>
 */
public final class EspProjector {

    /** Geometry closer than this in front of the camera is clipped away. */
    public static final float NEAR_PLANE = 0.05f;
    /** Clipped endpoints land exactly on the near plane, so rejection uses a smaller value. */
    private static final float MIN_VISIBLE = NEAR_PLANE * 0.5f;

    private final float[] matrix;
    private final int width;
    private final int height;

    private final float[] clipA = new float[4];
    private final float[] clipB = new float[4];
    private final float[] screenA = new float[2];
    private final float[] screenB = new float[2];

    public EspProjector(float[] viewMatrix, float[] projectionMatrix, int width, int height) {
        this.matrix = EspMath.multiply(projectionMatrix, viewMatrix);
        this.width = width;
        this.height = height;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    private void clip(double x, double y, double z, float[] out) {
        out[0] = matrix[0] * (float) x + matrix[1] * (float) y + matrix[2] * (float) z + matrix[3];
        out[1] = matrix[4] * (float) x + matrix[5] * (float) y + matrix[6] * (float) z + matrix[7];
        out[2] = matrix[8] * (float) x + matrix[9] * (float) y + matrix[10] * (float) z + matrix[11];
        out[3] = matrix[12] * (float) x + matrix[13] * (float) y + matrix[14] * (float) z + matrix[15];
    }

    private boolean toScreen(float[] clip, float[] out) {
        float w = clip[3];
        if (w < MIN_VISIBLE) {
            return false;
        }
        out[0] = (clip[0] / w * 0.5f + 0.5f) * width;
        out[1] = (0.5f - clip[1] / w * 0.5f) * height;
        return true;
    }

    /** Projects a single point. Returns false when the point is behind the camera. */
    public boolean point(double x, double y, double z, float[] out) {
        clip(x, y, z, clipA);
        return toScreen(clipA, out);
    }

    /**
     * Projects a segment, clipping it against the near plane. Returns false when
     * both endpoints are behind the camera.
     */
    public boolean segment(double x1, double y1, double z1,
            double x2, double y2, double z2, float[] out) {
        clip(x1, y1, z1, clipA);
        clip(x2, y2, z2, clipB);
        float w1 = clipA[3];
        float w2 = clipB[3];
        boolean behindA = w1 <= NEAR_PLANE;
        boolean behindB = w2 <= NEAR_PLANE;
        if (behindA && behindB) {
            return false;
        }
        if (behindA) {
            float t = (NEAR_PLANE - w1) / (w2 - w1);
            clipA[0] += (clipB[0] - clipA[0]) * t;
            clipA[1] += (clipB[1] - clipA[1]) * t;
            clipA[2] += (clipB[2] - clipA[2]) * t;
            clipA[3] = NEAR_PLANE;
        } else if (behindB) {
            float t = (NEAR_PLANE - w2) / (w1 - w2);
            clipB[0] += (clipA[0] - clipB[0]) * t;
            clipB[1] += (clipA[1] - clipB[1]) * t;
            clipB[2] += (clipA[2] - clipB[2]) * t;
            clipB[3] = NEAR_PLANE;
        }
        if (!toScreen(clipA, screenA) || !toScreen(clipB, screenB)) {
            return false;
        }
        out[0] = screenA[0];
        out[1] = screenA[1];
        out[2] = screenB[0];
        out[3] = screenB[1];
        return true;
    }

    /**
     * Frustum test in clip space. A box is rejected only when every corner is
     * outside the same plane, so partially visible boxes still draw.
     */
    public boolean visible(float[] bounds) {
        boolean anyLeft = false;
        boolean anyRight = false;
        boolean anyBottom = false;
        boolean anyTop = false;
        boolean anyFront = false;
        float[] clip = new float[4];
        for (int corner = 0; corner < 8; corner++) {
            double x = (corner & 1) == 0 ? bounds[0] : bounds[3];
            double y = (corner & 2) == 0 ? bounds[1] : bounds[4];
            double z = (corner & 4) == 0 ? bounds[2] : bounds[5];
            clip(x, y, z, clip);
            if (clip[3] > NEAR_PLANE) {
                anyFront = true;
            }
            if (clip[0] > -clip[3]) {
                anyRight = true;
            }
            if (clip[0] < clip[3]) {
                anyLeft = true;
            }
            if (clip[1] > -clip[3]) {
                anyTop = true;
            }
            if (clip[1] < clip[3]) {
                anyBottom = true;
            }
        }
        return anyFront && anyLeft && anyRight && anyTop && anyBottom;
    }
}
