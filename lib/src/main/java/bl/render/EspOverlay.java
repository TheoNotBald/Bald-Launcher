package bl.render;

import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.nio.IntBuffer;

import org.lwjgl.BufferUtils;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;
import org.lwjgl.opengl.GL13;
import org.lwjgl.opengl.GL14;
import org.lwjgl.opengl.GL15;
import org.lwjgl.opengl.GL20;
import org.lwjgl.opengl.GL30;

import bl.Bl;

/**
 * Transparent, click-through, always-on-top GLFW window that draws the ESP
 * outside Minecraft's framebuffer, so window capture (OBS window capture,
 * Discord window share, Medal) cannot see it while display capture still can.
 *
 * <p>The window owns a second GL context on its own thread. The game thread
 * only ever calls {@link #submit(EspSnapshot)} with an immutable snapshot; it
 * never makes a context current and never touches a GL object.</p>
 */
public final class EspOverlay {

    /** Window attribute value for mouse passthrough (added in GLFW 3.4). */
    private static final int MOUSE_PASSTHROUGH = 0x0002000D;
    private static final int MAX_VERTICES = 24576;
    private static final int FLOATS_PER_VERTEX = 8;

    private static final EspOverlay INSTANCE = new EspOverlay();

    public static EspOverlay get() {
        return INSTANCE;
    }

    private volatile EspSnapshot pending = EspSnapshot.EMPTY;
    private volatile GuiSnapshot gui = null;
    private volatile long guiStamp = 0L;
    private volatile boolean enabled = true;
    private volatile boolean running;
    private volatile boolean ready;
    private volatile boolean failed;
    private volatile long gameWindow;
    private volatile String passthrough = "not probed";

    private Thread thread;
    private long window;
    private boolean installedShutdownHook;

    private int program;
    private int vertexArray;
    private int vertexBuffer;
    private int fontTexture;
    private int viewportUniform;
    private int fontUniform;
    private final FloatBuffer vertices = BufferUtils.createFloatBuffer(MAX_VERTICES * FLOATS_PER_VERTEX);
    private final int[] shaderLog = new int[1];

    private boolean windowShown;
    private int lastX = Integer.MIN_VALUE;
    private int lastY = Integer.MIN_VALUE;
    private int lastWidth = Integer.MIN_VALUE;
    private int lastHeight = Integer.MIN_VALUE;

    private EspOverlay() {
    }

    public boolean isEnabled() {
        return enabled;
    }

    public boolean isActive() {
        return enabled && ready && !failed;
    }

    public String passthroughPath() {
        return passthrough;
    }

    /**
     * True when this build can make the overlay click-through, which is the
     * prerequisite for hosting an interactive GUI in it.
     */
    public boolean passthroughSupported() {
        return "glfw-attribute".equals(passthrough) || "raw-constant".equals(passthrough);
    }

    /** Draws the ClickGui in the overlay; null returns to the game's framebuffer. */
    public void submitGui(GuiSnapshot snapshot) {
        gui = snapshot == null || snapshot.isEmpty() ? null : snapshot;
        guiStamp = System.nanoTime();
    }

    public void attachGameWindow(long handle) {
        if (handle != 0L) {
            gameWindow = handle;
        }
    }

    public void submit(EspSnapshot snapshot) {
        pending = snapshot == null ? EspSnapshot.EMPTY : snapshot;
    }

    public boolean toggle() {
        enabled = !enabled;
        if (enabled) {
            start();
        }
        return enabled;
    }

    public synchronized void start() {
        if (running || failed) {
            return;
        }
        running = true;
        if (!installedShutdownHook) {
            installedShutdownHook = true;
            try {
                Runtime.getRuntime().addShutdownHook(new Thread(this::shutdown, "Bald ESP overlay shutdown"));
            } catch (Throwable t) {
                Bl.reportFailure("ESP overlay shutdown hook", t);
            }
        }
        thread = new Thread(this::run, "Bald ESP overlay");
        thread.setDaemon(true);
        thread.start();
    }

    public synchronized void shutdown() {
        if (!running) {
            return;
        }
        running = false;
        pending = EspSnapshot.EMPTY;
        gui = null;
        Thread worker = thread;
        if (worker != null && worker != Thread.currentThread()) {
            try {
                worker.join(1500L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
        thread = null;
    }

    private void run() {
        try {
            init();
            ready = true;
            System.out.println("[Bald ESP] overlay window ready, GLFW " + GLFW.glfwGetVersionString()
                    + ", mouse passthrough: " + passthrough);
            while (running) {
                frame();
                GLFW.glfwPollEvents();
                try {
                    Thread.sleep(2L);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (Throwable t) {
            failed = true;
            Bl.reportFailure("ESP overlay", t);
        } finally {
            ready = false;
            running = false;
            destroy();
        }
    }

    private void init() {
        if (GLFW.glfwGetCurrentContext() != 0L) {
            throw new IllegalStateException("Overlay thread must not inherit the game's GL context");
        }
        GLFW.glfwDefaultWindowHints();
        GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE, GLFW.GLFW_FALSE);
        GLFW.glfwWindowHint(GLFW.GLFW_DECORATED, GLFW.GLFW_FALSE);
        GLFW.glfwWindowHint(GLFW.GLFW_FLOATING, GLFW.GLFW_TRUE);
        GLFW.glfwWindowHint(GLFW.GLFW_FOCUS_ON_SHOW, GLFW.GLFW_FALSE);
        GLFW.glfwWindowHint(GLFW.GLFW_RESIZABLE, GLFW.GLFW_TRUE);
        GLFW.glfwWindowHint(GLFW.GLFW_TRANSPARENT_FRAMEBUFFER, GLFW.GLFW_TRUE);
        GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR, 3);
        GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR, 3);
        GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE, GLFW.GLFW_OPENGL_CORE_PROFILE);
        GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_FORWARD_COMPAT, GLFW.GLFW_TRUE);
        window = GLFW.glfwCreateWindow(320, 240, "Bald ESP", 0L, 0L);
        if (window == 0L) {
            throw new IllegalStateException("GLFW refused to create the overlay window");
        }
        GLFW.glfwMakeContextCurrent(window);
        GLFW.glfwSwapInterval(0);
        GL.createCapabilities();
        GLFW.glfwSetWindowAttrib(window, GLFW.GLFW_FLOATING, GLFW.GLFW_TRUE);
        GLFW.glfwSetWindowAttrib(window, GLFW.GLFW_FOCUS_ON_SHOW, GLFW.GLFW_FALSE);
        passthrough = applyMousePassthrough(window);
        createProgram();
        createFontTexture();
        createBuffers();
    }

    /**
     * GLFW only gained GLFW_MOUSE_PASSTHROUGH in 3.4 and Minecraft ships 3.3.x,
     * so the attribute is set through the binding constant first and retried
     * with the raw attribute value. Both paths are probed by reading the
     * attribute back, because an unsupported attribute is a silent no-op.
     */
    private static String applyMousePassthrough(long handle) {
        try {
            GLFW.glfwSetWindowAttrib(handle, GLFW.GLFW_MOUSE_PASSTHROUGH, GLFW.GLFW_TRUE);
            if (GLFW.glfwGetWindowAttrib(handle, GLFW.GLFW_MOUSE_PASSTHROUGH) == GLFW.GLFW_TRUE) {
                return "glfw-attribute";
            }
        } catch (Throwable ignored) {
            // The binding predates the constant; fall through to the raw value.
        }
        try {
            GLFW.glfwSetWindowAttrib(handle, MOUSE_PASSTHROUGH, GLFW.GLFW_TRUE);
            if (GLFW.glfwGetWindowAttrib(handle, MOUSE_PASSTHROUGH) == GLFW.GLFW_TRUE) {
                return "raw-constant";
            }
        } catch (Throwable ignored) {
            // Unsupported by the bundled native; caller reports it.
        }
        return "unsupported (bundled GLFW predates 3.4)";
    }

    private void createProgram() {
        String vertexSource = """
                #version 330 core
                layout(location = 0) in vec2 aPos;
                layout(location = 1) in vec2 aUv;
                layout(location = 2) in vec4 aColor;
                uniform vec2 uViewport;
                out vec2 vUv;
                out vec4 vColor;
                void main() {
                    vec2 ndc = vec2(aPos.x / uViewport.x * 2.0 - 1.0, 1.0 - aPos.y / uViewport.y * 2.0);
                    gl_Position = vec4(ndc, 0.0, 1.0);
                    vUv = aUv;
                    vColor = aColor;
                }
                """;
        String fragmentSource = """
                #version 330 core
                in vec2 vUv;
                in vec4 vColor;
                uniform sampler2D uFont;
                out vec4 fragColor;
                void main() {
                    float mask = vUv.x < 0.0 ? 1.0 : texture(uFont, vUv).r;
                    float alpha = vColor.a * mask;
                    if (alpha <= 0.002) {
                        discard;
                    }
                    fragColor = vec4(vColor.rgb * alpha, alpha);
                }
                """;
        int vertexShader = compile(GL20.GL_VERTEX_SHADER, vertexSource);
        int fragmentShader = compile(GL20.GL_FRAGMENT_SHADER, fragmentSource);
        program = GL20.glCreateProgram();
        GL20.glAttachShader(program, vertexShader);
        GL20.glAttachShader(program, fragmentShader);
        GL20.glLinkProgram(program);
        GL20.glGetProgramiv(program, GL20.GL_LINK_STATUS, shaderLog);
        if (shaderLog[0] == GL11.GL_FALSE) {
            String log = GL20.glGetProgramInfoLog(program);
            GL20.glDeleteProgram(program);
            program = 0;
            throw new IllegalStateException("Overlay shader link failed: " + log);
        }
        GL20.glDeleteShader(vertexShader);
        GL20.glDeleteShader(fragmentShader);
        viewportUniform = GL20.glGetUniformLocation(program, "uViewport");
        fontUniform = GL20.glGetUniformLocation(program, "uFont");
    }

    private int compile(int type, String source) {
        int shader = GL20.glCreateShader(type);
        GL20.glShaderSource(shader, source);
        GL20.glCompileShader(shader);
        GL20.glGetShaderiv(shader, GL20.GL_COMPILE_STATUS, shaderLog);
        if (shaderLog[0] == GL11.GL_FALSE) {
            String log = GL20.glGetShaderInfoLog(shader);
            GL20.glDeleteShader(shader);
            throw new IllegalStateException("Overlay shader compile failed: " + log);
        }
        return shader;
    }

    private void createFontTexture() {
        byte[] atlas = BitmapFont.atlas();
        ByteBuffer pixels = BufferUtils.createByteBuffer(atlas.length);
        pixels.put(atlas).flip();
        fontTexture = GL11.glGenTextures();
        GL11.glBindTexture(GL11.GL_TEXTURE_2D, fontTexture);
        GL11.glPixelStorei(GL11.GL_UNPACK_ALIGNMENT, 1);
        GL11.glTexImage2D(GL11.GL_TEXTURE_2D, 0, GL30.GL_R8, BitmapFont.ATLAS_WIDTH, BitmapFont.ATLAS_HEIGHT,
                0, GL11.GL_RED, GL11.GL_UNSIGNED_BYTE, pixels);
        GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MIN_FILTER, GL11.GL_NEAREST);
        GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_MAG_FILTER, GL11.GL_NEAREST);
        GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_WRAP_S, GL12.GL_CLAMP_TO_EDGE);
        GL11.glTexParameteri(GL11.GL_TEXTURE_2D, GL11.GL_TEXTURE_WRAP_T, GL12.GL_CLAMP_TO_EDGE);
    }

    private void createBuffers() {
        vertexArray = GL30.glGenVertexArrays();
        vertexBuffer = GL15.glGenBuffers();
        GL30.glBindVertexArray(vertexArray);
        GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vertexBuffer);
        int stride = FLOATS_PER_VERTEX * Float.BYTES;
        GL20.glEnableVertexAttribArray(0);
        GL20.glVertexAttribPointer(0, 2, GL11.GL_FLOAT, false, stride, 0L);
        GL20.glEnableVertexAttribArray(1);
        GL20.glVertexAttribPointer(1, 2, GL11.GL_FLOAT, false, stride, 2L * Float.BYTES);
        GL20.glEnableVertexAttribArray(2);
        GL20.glVertexAttribPointer(2, 4, GL11.GL_FLOAT, false, stride, 4L * Float.BYTES);
        GL30.glBindVertexArray(0);
    }

    private void frame() {
        long game = gameWindow;
        if (game == 0L) {
            hide();
            return;
        }
        int[] first = new int[1];
        int[] second = new int[1];
        GLFW.glfwGetWindowPos(game, first, second);
        int gameX = first[0];
        int gameY = second[0];
        GLFW.glfwGetWindowSize(game, first, second);
        int gameWidth = first[0];
        int gameHeight = second[0];
        boolean iconified = GLFW.glfwGetWindowAttrib(game, GLFW.GLFW_ICONIFIED) == GLFW.GLFW_TRUE;
        boolean visible = GLFW.glfwGetWindowAttrib(game, GLFW.GLFW_VISIBLE) == GLFW.GLFW_TRUE;
        int cursor = GLFW.glfwGetInputMode(game, GLFW.GLFW_CURSOR);

        EspSnapshot snapshot = pending;
        GuiSnapshot guiSnapshot = gui;
        // A screen that closes without going through Bl.closeMenu would otherwise
        // leave its last frame on the desktop, so the snapshot has to stay fresh.
        boolean guiMode = guiSnapshot != null && System.nanoTime() - guiStamp < 400_000_000L;
        // The GUI is interactive, so it is only ever shown while the overlay is
        // click-through; the world pass stays gated on a captured cursor.
        boolean drawable = visible && !iconified && gameWidth > 0 && gameHeight > 0
                && (guiMode || (snapshot != null && !snapshot.isEmpty()
                        && cursor == GLFW.GLFW_CURSOR_DISABLED));
        if (!drawable) {
            hide();
            return;
        }

        if (!windowShown) {
            GLFW.glfwShowWindow(window);
            windowShown = true;
            lastX = Integer.MIN_VALUE;
            lastY = Integer.MIN_VALUE;
            lastWidth = Integer.MIN_VALUE;
            lastHeight = Integer.MIN_VALUE;
        }
        if (gameX != lastX || gameY != lastY) {
            GLFW.glfwSetWindowPos(window, gameX, gameY);
            lastX = gameX;
            lastY = gameY;
        }
        if (gameWidth != lastWidth || gameHeight != lastHeight) {
            GLFW.glfwSetWindowSize(window, gameWidth, gameHeight);
            lastWidth = gameWidth;
            lastHeight = gameHeight;
        }
        int[] framebufferWidthBuffer = new int[1];
        int[] framebufferHeightBuffer = new int[1];
        GLFW.glfwGetFramebufferSize(window, framebufferWidthBuffer, framebufferHeightBuffer);
        int framebufferWidth = framebufferWidthBuffer[0];
        int framebufferHeight = framebufferHeightBuffer[0];
        if (framebufferWidth <= 0 || framebufferHeight <= 0) {
            return;
        }
        if (guiMode) {
            drawGui(guiSnapshot, framebufferWidth, framebufferHeight);
        } else {
            draw(snapshot, framebufferWidth, framebufferHeight);
        }
        GLFW.glfwSwapBuffers(window);
    }

    private void hide() {
        if (windowShown) {
            GLFW.glfwHideWindow(window);
            windowShown = false;
            lastX = Integer.MIN_VALUE;
            lastY = Integer.MIN_VALUE;
            lastWidth = Integer.MIN_VALUE;
            lastHeight = Integer.MIN_VALUE;
        }
    }

    private void draw(EspSnapshot snapshot, int framebufferWidth, int framebufferHeight) {
        GL11.glViewport(0, 0, framebufferWidth, framebufferHeight);
        GL11.glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
        GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);
        GL11.glDisable(GL11.GL_DEPTH_TEST);
        GL11.glDisable(GL11.GL_CULL_FACE);
        GL11.glDisable(GL11.GL_SCISSOR_TEST);
        GL11.glEnable(GL11.GL_BLEND);
        GL14.glBlendFuncSeparate(GL11.GL_ONE, GL11.GL_ONE_MINUS_SRC_ALPHA,
                GL11.GL_ONE, GL11.GL_ONE_MINUS_SRC_ALPHA);

        vertices.clear();
        float scaleX = framebufferWidth / (float) snapshot.width;
        float scaleY = framebufferHeight / (float) snapshot.height;

        float[] segments = snapshot.segments;
        int[] colors = snapshot.colors;
        for (int index = 0; index + 4 < segments.length; index += 5) {
            float x1 = segments[index] * scaleX;
            float y1 = segments[index + 1] * scaleY;
            float x2 = segments[index + 2] * scaleX;
            float y2 = segments[index + 3] * scaleY;
            quad(x1, y1, x2, y2, segments[index + 4], colors[index / 5]);
        }

        for (EspSnapshot.Label label : snapshot.labels) {
            float textWidth = BitmapFont.width(label.text(), label.scale()) * scaleX;
            float textHeight = BitmapFont.height(label.scale()) * scaleY;
            float centerX = label.x() * scaleX;
            float top = label.y() * scaleY;
            int background = label.background();
            if (((background >>> 24) & 0xFF) > 0) {
                rect(centerX - textWidth * 0.5f - 3.0f, top - 1.0f,
                        centerX + textWidth * 0.5f + 3.0f, top + textHeight + 1.0f, background);
            }
            drawText(label.text(), centerX - textWidth * 0.5f, top, label.scale() * scaleY, label.color());
        }

        if (vertices.position() == 0) {
            return;
        }
        vertices.flip();
        GL20.glUseProgram(program);
        GL20.glUniform2f(viewportUniform, framebufferWidth, framebufferHeight);
        GL13.glActiveTexture(GL13.GL_TEXTURE0);
        GL11.glBindTexture(GL11.GL_TEXTURE_2D, fontTexture);
        GL20.glUniform1i(fontUniform, 0);
        GL30.glBindVertexArray(vertexArray);
        GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vertexBuffer);
        GL15.glBufferData(GL15.GL_ARRAY_BUFFER, vertices, GL15.GL_STREAM_DRAW);
        GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, vertices.limit() / FLOATS_PER_VERTEX);
        GL30.glBindVertexArray(0);
        GL20.glUseProgram(0);
    }

    /**
     * Paints a recorded ClickGui display list. Primitives are grouped into runs
     * that share a scissor rectangle; each run is uploaded and drawn with its own
     * clip so scrolling columns keep their clipping.
     */
    private void drawGui(GuiSnapshot snapshot, int framebufferWidth, int framebufferHeight) {
        GL11.glViewport(0, 0, framebufferWidth, framebufferHeight);
        GL11.glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
        GL11.glClear(GL11.GL_COLOR_BUFFER_BIT);
        GL11.glDisable(GL11.GL_DEPTH_TEST);
        GL11.glDisable(GL11.GL_CULL_FACE);
        GL11.glEnable(GL11.GL_BLEND);
        GL14.glBlendFuncSeparate(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA,
                GL11.GL_ONE, GL11.GL_ONE_MINUS_SRC_ALPHA);

        float scaleX = framebufferWidth / (float) Math.max(1, snapshot.width);
        float scaleY = framebufferHeight / (float) Math.max(1, snapshot.height);

        GL20.glUseProgram(program);
        GL20.glUniform2f(viewportUniform, framebufferWidth, framebufferHeight);
        GL13.glActiveTexture(GL13.GL_TEXTURE0);
        GL11.glBindTexture(GL11.GL_TEXTURE_2D, fontTexture);
        GL20.glUniform1i(fontUniform, 0);
        GL30.glBindVertexArray(vertexArray);
        GL15.glBindBuffer(GL15.GL_ARRAY_BUFFER, vertexBuffer);

        vertices.clear();
        float[] clip = null;
        for (GuiSnapshot.Primitive primitive : snapshot.primitives) {
            float[] next = { primitive.clipX0(), primitive.clipY0(),
                    primitive.clipX1(), primitive.clipY1() };
            if (!sameClip(clip, next)) {
                flushGui(framebufferWidth, framebufferHeight, clip, scaleX, scaleY);
                clip = next;
            }
            if (primitive instanceof GuiSnapshot.Rect box) {
                gradientRect(box.x0() * scaleX, box.y0() * scaleY,
                        box.x1() * scaleX, box.y1() * scaleY, box.top(), box.bottom());
            } else if (primitive instanceof GuiSnapshot.Text text) {
                drawText(text.value(), text.x() * scaleX, text.y() * scaleY,
                        text.scale() * scaleY, text.color());
            }
        }
        flushGui(framebufferWidth, framebufferHeight, clip, scaleX, scaleY);

        GL11.glDisable(GL11.GL_SCISSOR_TEST);
        GL30.glBindVertexArray(0);
        GL20.glUseProgram(0);
    }

    private static boolean sameClip(float[] current, float[] next) {
        if (current == null || next == null) {
            return current == next;
        }
        return current[0] == next[0] && current[1] == next[1]
                && current[2] == next[2] && current[3] == next[3];
    }

    private void flushGui(int framebufferWidth, int framebufferHeight, float[] clip,
            float scaleX, float scaleY) {
        if (vertices.position() == 0) {
            return;
        }
        if (clip == null) {
            GL11.glDisable(GL11.GL_SCISSOR_TEST);
        } else {
            int x0 = Math.max(0, Math.round(clip[0] * scaleX));
            int y0 = Math.max(0, Math.round(clip[1] * scaleY));
            int x1 = Math.min(framebufferWidth, Math.round(clip[2] * scaleX));
            int y1 = Math.min(framebufferHeight, Math.round(clip[3] * scaleY));
            GL11.glEnable(GL11.GL_SCISSOR_TEST);
            GL11.glScissor(x0, framebufferHeight - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
        }
        vertices.flip();
        GL15.glBufferData(GL15.GL_ARRAY_BUFFER, vertices, GL15.GL_STREAM_DRAW);
        GL11.glDrawArrays(GL11.GL_TRIANGLES, 0, vertices.limit() / FLOATS_PER_VERTEX);
        vertices.clear();
    }

    private void gradientRect(float x0, float y0, float x1, float y1, int top, int bottom) {
        float topAlpha = ((top >>> 24) & 0xFF) / 255.0f;
        float topRed = ((top >>> 16) & 0xFF) / 255.0f;
        float topGreen = ((top >>> 8) & 0xFF) / 255.0f;
        float topBlue = (top & 0xFF) / 255.0f;
        float bottomAlpha = ((bottom >>> 24) & 0xFF) / 255.0f;
        float bottomRed = ((bottom >>> 16) & 0xFF) / 255.0f;
        float bottomGreen = ((bottom >>> 8) & 0xFF) / 255.0f;
        float bottomBlue = (bottom & 0xFF) / 255.0f;
        vertex(x0, y0, -1.0f, -1.0f, topRed, topGreen, topBlue, topAlpha);
        vertex(x1, y0, -1.0f, -1.0f, topRed, topGreen, topBlue, topAlpha);
        vertex(x1, y1, -1.0f, -1.0f, bottomRed, bottomGreen, bottomBlue, bottomAlpha);
        vertex(x0, y0, -1.0f, -1.0f, topRed, topGreen, topBlue, topAlpha);
        vertex(x1, y1, -1.0f, -1.0f, bottomRed, bottomGreen, bottomBlue, bottomAlpha);
        vertex(x0, y1, -1.0f, -1.0f, bottomRed, bottomGreen, bottomBlue, bottomAlpha);
    }

    private void drawText(String text, float x, float y, float scale, int color) {
        float advance = BitmapFont.advance(scale);
        float glyphHeight = BitmapFont.height(scale);
        float uScale = 1.0f / BitmapFont.ATLAS_WIDTH;
        float vScale = 1.0f / BitmapFont.ATLAS_HEIGHT;
        float cursor = x;
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (character == ' ') {
                cursor += advance;
                continue;
            }
            float u0 = BitmapFont.cellX(character) * uScale;
            float v0 = BitmapFont.cellY(character) * vScale;
            float u1 = (BitmapFont.cellX(character) + BitmapFont.GLYPH_WIDTH) * uScale;
            float v1 = (BitmapFont.cellY(character) + BitmapFont.GLYPH_HEIGHT) * vScale;
            float x0 = cursor;
            float x1 = cursor + BitmapFont.GLYPH_WIDTH * scale;
            float y0 = y;
            float y1 = y + glyphHeight;
            texturedQuad(x0, y0, x1, y1, u0, v0, u1, v1, color);
            cursor += advance;
        }
    }

    private void rect(float x0, float y0, float x1, float y1, int color) {
        float alpha = ((color >>> 24) & 0xFF) / 255.0f;
        float red = ((color >>> 16) & 0xFF) / 255.0f;
        float green = ((color >>> 8) & 0xFF) / 255.0f;
        float blue = (color & 0xFF) / 255.0f;
        vertex(x0, y0, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(x1, y0, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(x1, y1, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(x0, y0, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(x1, y1, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(x0, y1, -1.0f, -1.0f, red, green, blue, alpha);
    }

    private void texturedQuad(float x0, float y0, float x1, float y1,
            float u0, float v0, float u1, float v1, int color) {
        float alpha = ((color >>> 24) & 0xFF) / 255.0f;
        float red = ((color >>> 16) & 0xFF) / 255.0f;
        float green = ((color >>> 8) & 0xFF) / 255.0f;
        float blue = (color & 0xFF) / 255.0f;
        vertex(x0, y0, u0, v0, red, green, blue, alpha);
        vertex(x1, y0, u1, v0, red, green, blue, alpha);
        vertex(x1, y1, u1, v1, red, green, blue, alpha);
        vertex(x0, y0, u0, v0, red, green, blue, alpha);
        vertex(x1, y1, u1, v1, red, green, blue, alpha);
        vertex(x0, y1, u0, v1, red, green, blue, alpha);
    }

    private void quad(float x1, float y1, float x2, float y2, float width, int color) {
        float dx = x2 - x1;
        float dy = y2 - y1;
        float length = (float) Math.sqrt(dx * dx + dy * dy);
        if (length < 0.001f) {
            return;
        }
        float half = Math.max(1.0f, width) * 0.5f;
        float nx = -dy / length * half;
        float ny = dx / length * half;
        float ax = x1 + nx;
        float ay = y1 + ny;
        float bx = x2 + nx;
        float by = y2 + ny;
        float cx = x2 - nx;
        float cy = y2 - ny;
        float ex = x1 - nx;
        float ey = y1 - ny;
        float alpha = ((color >>> 24) & 0xFF) / 255.0f;
        float red = ((color >>> 16) & 0xFF) / 255.0f;
        float green = ((color >>> 8) & 0xFF) / 255.0f;
        float blue = (color & 0xFF) / 255.0f;
        vertex(ax, ay, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(bx, by, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(cx, cy, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(ax, ay, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(cx, cy, -1.0f, -1.0f, red, green, blue, alpha);
        vertex(ex, ey, -1.0f, -1.0f, red, green, blue, alpha);
    }

    private void vertex(float x, float y, float u, float v,
            float red, float green, float blue, float alpha) {
        if (vertices.position() + FLOATS_PER_VERTEX > vertices.capacity()) {
            return;
        }
        vertices.put(x).put(y).put(u).put(v).put(red).put(green).put(blue).put(alpha);
    }

    private void destroy() {
        try {
            if (window != 0L) {
                GLFW.glfwMakeContextCurrent(0L);
                if (program != 0) {
                    GL20.glDeleteProgram(program);
                }
                if (vertexBuffer != 0) {
                    GL15.glDeleteBuffers(vertexBuffer);
                }
                if (vertexArray != 0) {
                    GL30.glDeleteVertexArrays(vertexArray);
                }
                if (fontTexture != 0) {
                    GL11.glDeleteTextures(fontTexture);
                }
                program = 0;
                vertexBuffer = 0;
                vertexArray = 0;
                fontTexture = 0;
                GLFW.glfwDestroyWindow(window);
                window = 0L;
            }
        } catch (Throwable t) {
            Bl.reportFailure("ESP overlay teardown", t);
        } finally {
            windowShown = false;
            System.out.println("[Bald ESP] overlay window destroyed");
        }
    }
}
