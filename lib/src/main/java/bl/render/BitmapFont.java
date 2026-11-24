package bl.render;

/**
 * Small built-in 5x7 bitmap font used by the overlay window. It deliberately
 * does not touch Minecraft's font renderer: text is measured on the game thread
 * (for screen-edge clamping) and rasterised on the overlay thread, so both sides
 * must share the same metrics.
 */
public final class BitmapFont {

    public static final int CELL = 8;
    public static final int GLYPH_WIDTH = 5;
    public static final int GLYPH_HEIGHT = 7;
    public static final int COLUMNS = 16;
    public static final int ROWS = 6;
    public static final int ATLAS_WIDTH = COLUMNS * CELL;
    public static final int ATLAS_HEIGHT = ROWS * CELL;

    private static final int FIRST = 32;
    private static final int LAST = 126;
    private static final int[][] GLYPHS = new int[LAST - FIRST + 1][GLYPH_HEIGHT];
    private static final boolean[] DEFINED = new boolean[LAST - FIRST + 1];

    private BitmapFont() {
    }

    static {
        for (int[] glyph : GLYPHS) {
            for (int row = 0; row < GLYPH_HEIGHT; row++) {
                glyph[row] = 0;
            }
        }
        glyph(' ', 0, 0, 0, 0, 0, 0, 0);
        glyph('!', 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100);
        glyph('"', 0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000);
        glyph('#', 0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010);
        glyph('%', 0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011);
        glyph('&', 0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101);
        glyph('\'', 0b00100, 0b00100, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000);
        glyph('(', 0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010);
        glyph(')', 0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000);
        glyph('*', 0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0b00000);
        glyph('+', 0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000);
        glyph(',', 0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00110, 0b01100);
        glyph('-', 0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000);
        glyph('.', 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100);
        glyph('/', 0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000);
        glyph('0', 0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110);
        glyph('1', 0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110);
        glyph('2', 0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111);
        glyph('3', 0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110);
        glyph('4', 0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010);
        glyph('5', 0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110);
        glyph('6', 0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110);
        glyph('7', 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000);
        glyph('8', 0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110);
        glyph('9', 0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100);
        glyph(':', 0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000);
        glyph(';', 0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b01000);
        glyph('<', 0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010);
        glyph('=', 0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000);
        glyph('>', 0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000);
        glyph('?', 0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100);
        glyph('@', 0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110);
        glyph('A', 0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001);
        glyph('B', 0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110);
        glyph('C', 0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110);
        glyph('D', 0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110);
        glyph('E', 0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111);
        glyph('F', 0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000);
        glyph('G', 0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111);
        glyph('H', 0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001);
        glyph('I', 0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110);
        glyph('J', 0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100);
        glyph('K', 0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001);
        glyph('L', 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111);
        glyph('M', 0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001);
        glyph('N', 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001);
        glyph('O', 0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110);
        glyph('P', 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000);
        glyph('Q', 0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101);
        glyph('R', 0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001);
        glyph('S', 0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110);
        glyph('T', 0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100);
        glyph('U', 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110);
        glyph('V', 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100);
        glyph('W', 0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001);
        glyph('X', 0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001);
        glyph('Y', 0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100);
        glyph('Z', 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111);
        glyph('[', 0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110);
        glyph('\\', 0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001);
        glyph(']', 0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110);
        glyph('^', 0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000);
        glyph('_', 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111);
        glyph('`', 0b01000, 0b00100, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000);
        glyph('|', 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100);
        glyph('~', 0b00000, 0b00000, 0b01000, 0b10101, 0b00010, 0b00000, 0b00000);
        int[] unknown = GLYPHS['?' - FIRST];
        for (int index = 0; index < GLYPHS.length; index++) {
            if (!DEFINED[index]) {
                System.arraycopy(unknown, 0, GLYPHS[index], 0, GLYPH_HEIGHT);
            }
        }
    }

    private static void glyph(char character, int... rows) {
        int index = character - FIRST;
        if (index < 0 || index >= GLYPHS.length) {
            return;
        }
        DEFINED[index] = true;
        for (int row = 0; row < GLYPH_HEIGHT && row < rows.length; row++) {
            GLYPHS[index][row] = rows[row];
        }
    }

    private static int[] rows(char character) {
        char upper = Character.toUpperCase(character);
        int index = upper - FIRST;
        if (index < 0 || index >= GLYPHS.length) {
            index = '?' - FIRST;
        }
        return GLYPHS[index];
    }

    public static int glyphRow(char character, int row) {
        if (row < 0 || row >= GLYPH_HEIGHT) {
            return 0;
        }
        return rows(character)[row];
    }

    /** Cell origin inside the atlas, in pixels. */
    public static int cellX(char character) {
        int index = clampIndex(character);
        return (index % COLUMNS) * CELL;
    }

    public static int cellY(char character) {
        int index = clampIndex(character);
        return (index / COLUMNS) * CELL;
    }

    private static int clampIndex(char character) {
        char upper = Character.toUpperCase(character);
        int index = upper - FIRST;
        if (index < 0 || index >= GLYPHS.length) {
            index = '?' - FIRST;
        }
        return index;
    }

    /** Pixels between the left edge of one glyph and the next, at scale 1. */
    public static final float ADVANCE = 6.0f;

    public static float width(String text, float scale) {
        if (text == null || text.isEmpty()) {
            return 0.0f;
        }
        return (text.length() * ADVANCE - (ADVANCE - GLYPH_WIDTH)) * scale;
    }

    public static float height(float scale) {
        return GLYPH_HEIGHT * scale;
    }

    public static float advance(float scale) {
        return ADVANCE * scale;
    }

    /** Builds the single-channel atlas the overlay uploads once at startup. */
    public static byte[] atlas() {
        byte[] pixels = new byte[ATLAS_WIDTH * ATLAS_HEIGHT];
        for (int code = FIRST; code <= LAST; code++) {
            char character = (char) code;
            int index = code - FIRST;
            int originX = (index % COLUMNS) * CELL;
            int originY = (index / COLUMNS) * CELL;
            for (int row = 0; row < GLYPH_HEIGHT; row++) {
                int bits = glyphRow(character, row);
                for (int column = 0; column < GLYPH_WIDTH; column++) {
                    if ((bits & (1 << (GLYPH_WIDTH - 1 - column))) == 0) {
                        continue;
                    }
                    int x = originX + column;
                    int y = originY + row;
                    if (x < 0 || x >= ATLAS_WIDTH || y < 0 || y >= ATLAS_HEIGHT) {
                        continue;
                    }
                    pixels[y * ATLAS_WIDTH + x] = (byte) 0xFF;
                }
            }
        }
        return pixels;
    }
}
