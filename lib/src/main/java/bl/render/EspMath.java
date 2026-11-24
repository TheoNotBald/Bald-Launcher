package bl.render;

import bl.mc.Reflect;

/**
 * Pure-Java matrix helpers for the ESP renderer. Matrices are row-major
 * {@code float[16]} arrays so the projection code can be unit tested without
 * touching JOML or a live game.
 */
public final class EspMath {

    private EspMath() {
    }

    public static float[] multiply(float[] left, float[] right) {
        float[] result = new float[16];
        for (int row = 0; row < 4; row++) {
            for (int column = 0; column < 4; column++) {
                float sum = 0.0f;
                for (int index = 0; index < 4; index++) {
                    sum += left[row * 4 + index] * right[index * 4 + column];
                }
                result[row * 4 + column] = sum;
            }
        }
        return result;
    }

    /**
     * Reads a JOML {@code Matrix4f} into row-major order. JOML names its
     * accessors {@code m<column><row>}, so the value for math row r, column c
     * is {@code m<c><r>}.
     */
    public static float[] fromMinecraft(Object matrix) {
        if (matrix == null) {
            return null;
        }
        float[] result = new float[16];
        for (int column = 0; column < 4; column++) {
            for (int row = 0; row < 4; row++) {
                Object value = Reflect.call(matrix, "m" + column + row);
                if (!(value instanceof Number number)) {
                    return null;
                }
                result[row * 4 + column] = number.floatValue();
            }
        }
        return result;
    }

    /** Reads the x/y/z/double components of a Minecraft {@code Vec3}. */
    public static boolean readVec(Object vector, double[] out) {
        if (vector == null || out == null) {
            return false;
        }
        Object x = Reflect.call(vector, "x");
        Object y = Reflect.call(vector, "y");
        Object z = Reflect.call(vector, "z");
        if (!(x instanceof Number nx) || !(y instanceof Number ny) || !(z instanceof Number nz)) {
            return false;
        }
        out[0] = nx.doubleValue();
        out[1] = ny.doubleValue();
        out[2] = nz.doubleValue();
        return true;
    }
}
