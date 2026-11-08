package bl.util;

public final class MathUtil {

    private MathUtil() {
    }

    public static double wrap(double degrees) {
        double value = degrees % 360.0;
        if (value >= 180.0) {
            value -= 360.0;
        }
        if (value < -180.0) {
            value += 360.0;
        }
        return value;
    }

    public static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    public static double distance(double x1, double y1, double z1, double x2, double y2, double z2) {
        double dx = x1 - x2;
        double dy = y1 - y2;
        double dz = z1 - z2;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public static int lerpColor(int from, int to, float delta) {
        int a = (int) (((from >> 24) & 0xFF) + (((to >> 24) & 0xFF) - ((from >> 24) & 0xFF)) * delta);
        int r = (int) (((from >> 16) & 0xFF) + (((to >> 16) & 0xFF) - ((from >> 16) & 0xFF)) * delta);
        int g = (int) (((from >> 8) & 0xFF) + (((to >> 8) & 0xFF) - ((from >> 8) & 0xFF)) * delta);
        int b = (int) ((from & 0xFF) + ((to & 0xFF) - (from & 0xFF)) * delta);
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    public static float fade(int color, double distance, double maxDistance) {
        float alpha = (float) Math.max(0.0, 1.0 - distance / maxDistance);
        return ((color >> 24) & 0xFF) / 255.0f * alpha;
    }
}
