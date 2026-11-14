package bl.rotation;

import bl.mc.Reflect;

public final class RotationManager {

    public enum Mode {
        INSTANT,
        SMOOTH,
        SNAP
    }

    private static final double DUPLICATE_EPSILON = 0.001;
    private static final float READY_DELTA = 5.0f;
    // Grim 2.3.75 GrimMath.java:12
    private static final float MINIMUM_DIVISOR = 0.0086f;

    private Mode mode = Mode.SMOOTH;
    private float targetYaw;
    private float targetPitch;
    private float currentYaw;
    private float currentPitch;
    private float lastSentYaw = Float.NaN;
    private float lastSentPitch = Float.NaN;
    private boolean pending;
    private boolean seeded;

    public void setMode(Mode mode) {
        this.mode = mode;
    }

    public Mode getMode() {
        return mode;
    }

    public void request(float yaw, float pitch) {
        this.targetYaw = yaw;
        this.targetPitch = pitch;
        this.pending = true;
    }

    public float getYaw() {
        return targetYaw;
    }

    public float getPitch() {
        return targetPitch;
    }

    public boolean isPending() {
        return pending;
    }

    public void tick() {
        if (!seeded) {
            seed(Reflect.yaw(), Reflect.pitch());
            seeded = true;
        }
        float[] rotation = resolve(Reflect.sensitivity());
        if (rotation != null) {
            Reflect.applyRotation(rotation[0], rotation[1]);
        }
    }

    public boolean isReady() {
        return Math.abs(wrapDegrees(targetYaw - currentYaw)) < READY_DELTA
                && Math.abs(targetPitch - currentPitch) < READY_DELTA;
    }

    public void seed(float yaw, float pitch) {
        currentYaw = yaw;
        currentPitch = pitch;
        targetYaw = yaw;
        targetPitch = pitch;
        lastSentYaw = Float.NaN;
        lastSentPitch = Float.NaN;
        seeded = true;
    }

    public float[] resolve(float sensitivity) {
        if (!pending) {
            return null;
        }
        float yaw = targetYaw;
        float pitch = targetPitch;

        if (mode != Mode.INSTANT) {
            float factor = mode == Mode.SNAP ? 1.0f : 0.45f;
            yaw = currentYaw + wrapDegrees(targetYaw - currentYaw) * factor;
            pitch = currentPitch + (targetPitch - currentPitch) * factor;
        }

        float step = gcdStep(sensitivity);
        yaw = snap(yaw, step);
        pitch = snap(pitch, step);

        pitch = Math.max(-90.0f, Math.min(90.0f, pitch));

        currentYaw = yaw;
        currentPitch = pitch;

        if (Math.abs(yaw - lastSentYaw) < DUPLICATE_EPSILON && Math.abs(pitch - lastSentPitch) < DUPLICATE_EPSILON) {
            return null;
        }
        lastSentYaw = yaw;
        lastSentPitch = pitch;

        if (Math.abs(wrapDegrees(targetYaw - yaw)) < 0.05f && Math.abs(targetPitch - pitch) < 0.05f) {
            pending = false;
        }
        return new float[] { yaw, pitch };
    }

    public static float gcdStep(float sensitivity) {
        float f = sensitivity * 0.6f + 0.2f;
        float g = f * f * f * 1.2f;
        return Math.max(g * 8.0f * 0.15f, MINIMUM_DIVISOR);
    }

    public static float snapToStep(float value, float step) {
        if (step <= 0.0f) {
            return value;
        }
        return Math.round(value / step) * step;
    }

    private static float snap(float value, float step) {
        return snapToStep(value, step);
    }

    private static float wrapDegrees(float degrees) {
        float wrapped = degrees % 360.0f;
        if (wrapped >= 180.0f) {
            wrapped -= 360.0f;
        }
        if (wrapped < -180.0f) {
            wrapped += 360.0f;
        }
        return wrapped;
    }

    public void reset() {
        pending = false;
        lastSentYaw = Float.NaN;
        lastSentPitch = Float.NaN;
    }
}
