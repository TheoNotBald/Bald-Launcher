package bl.render;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;

import bl.Bl;
import bl.mc.GizmoDraw;
import bl.mc.Reflect;

/**
 * Game-thread entry point for every ESP module.
 *
 * <p>Modules push world-space primitives during {@code RenderLevelEvent}; this
 * class either projects them into a screen-space snapshot for the overlay
 * window, or draws them in the world pass when the overlay is switched off.
 * Entity boxes come from a per-entity previous/current tick cache so moving
 * targets interpolate instead of jittering, and entries that stop being seen
 * (kill, despawn, chunk unload, dimension change, world unload) are dropped at
 * the end of the frame.</p>
 */
public final class EspScene {

    private static final EspScene INSTANCE = new EspScene();

    private static final class Track {
        float[] previous;
        float[] current;
        long tick;
        int stamp;
    }

    private final EspFrame frame = new EspFrame();
    private final Map<Integer, Track> tracks = new HashMap<>();
    private final Set<Integer> drawn = new HashSet<>();
    private final float[] screenPoint = new float[4];

    private Object world;
    private Object renderer;
    private Object camera;
    private float[] viewMatrix;
    private float[] projectionMatrix;
    private float tickDelta;
    private double worldTick;
    private int stamp;
    private int framebufferWidth;
    private int framebufferHeight;
    private boolean blocked;
    private boolean overlayEnabled = true;
    private final double[] eye = new double[3];

    private EspScene() {
    }

    public static EspScene get() {
        return INSTANCE;
    }

    /** Called once per frame before the module render pass. */
    public void begin(Object levelRenderer, Object tickCounter, Object renderCamera,
            Object positionMatrix, Object projectionMatrix) {
        this.renderer = levelRenderer;
        this.camera = renderCamera;
        this.frame.clear();
        this.drawn.clear();
        this.stamp++;
        this.viewMatrix = EspMath.fromMinecraft(positionMatrix);
        this.projectionMatrix = EspMath.fromMinecraft(projectionMatrix);
        Object progress = Reflect.call(tickCounter, "getTickProgress", false);
        this.tickDelta = progress instanceof Number number ? number.floatValue() : 1.0f;

        Object resolvedWorld = Reflect.world();
        if (resolvedWorld != world) {
            // Dimension change or world unload: nothing may survive the old world.
            tracks.clear();
            world = resolvedWorld;
        }
        Object time = world == null ? null : Reflect.call(world, "getTime");
        this.worldTick = time instanceof Number number ? number.longValue() : 0L;

        this.blocked = isBlocked();
        Object window = Reflect.call(Reflect.instance(), "getWindow");
        Object fbWidth = Reflect.call(window, "getFramebufferWidth");
        Object fbHeight = Reflect.call(window, "getFramebufferHeight");
        this.framebufferWidth = fbWidth instanceof Number number ? number.intValue() : 0;
        this.framebufferHeight = fbHeight instanceof Number number ? number.intValue() : 0;
        Object handle = Reflect.call(window, "getHandle");
        if (handle instanceof Number number) {
            EspOverlay.get().attachGameWindow(number.longValue());
        }
        EspOverlay.get().start();
    }

    /**
     * True while a screen, the chat, the inventory or the debug HUD is open.
     * Nothing is drawn in any of those states.
     */
    private boolean isBlocked() {
        Object minecraft = Reflect.instance();
        if (minecraft == null) {
            return true;
        }
        if (Reflect.getField(minecraft, "currentScreen") != null) {
            return true;
        }
        Object debugHud = Reflect.call(minecraft, "getDebugHud");
        Object showing = debugHud == null ? null : Reflect.call(debugHud, "shouldShowDebugHud");
        return showing instanceof Boolean visible && visible;
    }

    public boolean blocked() {
        return blocked;
    }

    public float tickDelta() {
        return tickDelta;
    }

    public int entityId(Object entity) {
        Object id = Reflect.call(entity, "getId");
        return id instanceof Number number ? number.intValue() : System.identityHashCode(entity);
    }

    /**
     * Interpolated, de-duplicated box for one entity. Returns null when the
     * entity cannot be read.
     */
    public float[] entityBox(Object entity) {
        Object bounds = Reflect.call(entity, "getBoundingBox");
        if (bounds == null) {
            bounds = Reflect.callReturning(entity, "net/minecraft/world/phys/AABB", "getBoundingBox");
        }
        float[] current = readBox(bounds);
        if (current == null) {
            return null;
        }
        int id = entityId(entity);
        Track track = tracks.get(id);
        if (track == null) {
            track = new Track();
            track.previous = current;
            track.current = current;
            track.tick = (long) worldTick;
            tracks.put(id, track);
        } else if (track.tick != (long) worldTick) {
            track.previous = track.current;
            track.current = current;
            track.tick = (long) worldTick;
        } else {
            track.current = current;
        }
        track.stamp = stamp;
        float delta = Math.max(0.0f, Math.min(1.5f, tickDelta));
        float[] result = new float[6];
        for (int index = 0; index < 6; index++) {
            result[index] = track.previous[index] + (track.current[index] - track.previous[index]) * delta;
        }
        return result;
    }

    private static float[] readBox(Object box) {
        if (box == null) {
            return null;
        }
        float[] result = new float[6];
        String[] names = { "minX", "minY", "minZ", "maxX", "maxY", "maxZ" };
        for (int index = 0; index < names.length; index++) {
            Object value = Reflect.getField(box, names[index]);
            if (!(value instanceof Number number)) {
                return null;
            }
            result[index] = number.floatValue();
        }
        return result;
    }

    /** Adds an entity box unless another module already drew that entity. */
    public void box(int id, float[] bounds, int color, boolean throughWalls) {
        if (bounds == null || color == 0) {
            return;
        }
        if (!drawn.add(id)) {
            return;
        }
        // Lift the stroke a hair off neighbouring surfaces so coplanar edges do
        // not z-fight against flat ground or blocks.
        float epsilon = 0.002f;
        frame.box(bounds[0] - epsilon, bounds[1] - epsilon, bounds[2] - epsilon,
                bounds[3] + epsilon, bounds[4] + epsilon, bounds[5] + epsilon, color, throughWalls);
    }

    public void blockBox(float minX, float minY, float minZ, float maxX, float maxY, float maxZ,
            int color, boolean throughWalls) {
        frame.box(minX, minY, minZ, maxX, maxY, maxZ, color, throughWalls);
    }

    public void label(Object entity, int yOffset, float x, float y, float z,
            String text, int color, int background, float scale) {
        frame.label(entity, yOffset, x, y, z, text, color, background, scale);
    }

    public void tracer(float x, float y, float z, int color, float width) {
        frame.tracer(x, y, z, color, width);
    }

    public void line(float x1, float y1, float z1, float x2, float y2, float z2,
            int color, float width, boolean throughWalls) {
        frame.line(x1, y1, z1, x2, y2, z2, color, width, throughWalls);
    }

    /**
     * Ends the frame: publishes the projected snapshot to the overlay, or draws
     * the same primitives in Minecraft's world pass when the overlay is off.
     */
    public void end() {
        try {
            purge();
            reportFrame();
            if (blocked || frame.isEmpty()) {
                EspOverlay.get().submit(EspSnapshot.EMPTY);
                return;
            }
            if (overlayEnabled && EspOverlay.get().isActive()) {
                EspProjector projector = projector();
                if (projector != null) {
                    EspOverlay.get().submit(frame.snapshot(projector));
                    return;
                }
            }
            drawInGame();
        } catch (Throwable t) {
            Bl.reportFailure("ESP render", t);
        } finally {
            frame.clear();
        }
    }

    private long lastReportMillis;

    /**
     * Periodic one-line status so a launch that draws nothing can be told
     * apart from one whose modules never produced geometry.
     */
    private void reportFrame() {
        long now = System.currentTimeMillis();
        if (now - lastReportMillis < 3000L) {
            return;
        }
        lastReportMillis = now;
        System.out.println("[Bald ESP] frame boxes=" + frame.boxes().size()
                + " lines=" + frame.lines().size()
                + " labels=" + frame.labels().size()
                + " overlayActive=" + EspOverlay.get().isActive()
                + " overlayEnabled=" + overlayEnabled
                + " fb=" + framebufferWidth + "x" + framebufferHeight
                + " passthrough=" + EspOverlay.get().passthroughPath());
    }

    private EspProjector projector() {
        if (viewMatrix == null || projectionMatrix == null
                || framebufferWidth <= 0 || framebufferHeight <= 0) {
            return null;
        }
        return new EspProjector(viewMatrix, projectionMatrix, framebufferWidth, framebufferHeight);
    }

    private void purge() {
        Iterator<Map.Entry<Integer, Track>> iterator = tracks.entrySet().iterator();
        while (iterator.hasNext()) {
            if (iterator.next().getValue().stamp != stamp) {
                iterator.remove();
            }
        }
    }

    private void drawInGame() {
        Object levelRenderer = renderer;
        if (levelRenderer == null) {
            return;
        }
        GizmoDraw.inScope(levelRenderer, ignored -> {
            for (EspFrame.BoxPrim box : frame.boxes()) {
                GizmoDraw.box(box.bounds, box.color, EspPalette.LINE_WIDTH, box.throughWalls);
            }
            for (EspFrame.LinePrim line : frame.lines()) {
                GizmoDraw.line(line.points, line.color, line.width, line.throughWalls);
            }
            double[] origin = tracerOrigin();
            for (EspFrame.TracerPrim tracer : frame.tracers()) {
                GizmoDraw.line(origin[0], origin[1], origin[2],
                        tracer.target[0], tracer.target[1], tracer.target[2],
                        tracer.color, tracer.width, true);
            }
            for (EspFrame.LabelPrim label : frame.labels()) {
                if (label.entity == null) {
                    continue;
                }
                GizmoDraw.entityLabel(label.entity, label.yOffset, label.text,
                        label.color, label.scale, EspPalette.LABEL_BACKGROUND);
            }
        });
    }

    /** Eye position nudged forward, so the tracer start is not inside the near plane. */
    private double[] tracerOrigin() {
        double x = 0.0;
        double y = 0.0;
        double z = 0.0;
        if (EspMath.readVec(Reflect.call(camera, "getCameraPos"), eye)) {
            x = eye[0];
            y = eye[1];
            z = eye[2];
        }
        Object yawValue = Reflect.call(camera, "getYaw");
        Object pitchValue = Reflect.call(camera, "getPitch");
        float yaw = yawValue instanceof Number number ? number.floatValue() : Reflect.yaw();
        float pitch = pitchValue instanceof Number number ? number.floatValue() : Reflect.pitch();
        double yawRadians = Math.toRadians(yaw);
        double pitchRadians = Math.toRadians(pitch);
        double forwardX = -Math.sin(yawRadians) * Math.cos(pitchRadians);
        double forwardY = -Math.sin(pitchRadians);
        double forwardZ = Math.cos(yawRadians) * Math.cos(pitchRadians);
        return new double[] { x + forwardX * 1.2, y + forwardY * 1.2, z + forwardZ * 1.2 };
    }

    /** One in-game switch for the overlay; the modules keep rendering either way. */
    public void toggleOverlay() {
        overlayEnabled = EspOverlay.get().toggle();
        if (overlayEnabled) {
            EspOverlay.get().start();
        } else {
            EspOverlay.get().submit(EspSnapshot.EMPTY);
        }
    }

    public boolean overlayEnabled() {
        return overlayEnabled;
    }

    public String overlayStatus() {
        if (!overlayEnabled) {
            return "overlay off";
        }
        if (!EspOverlay.get().isActive()) {
            return "overlay unavailable";
        }
        return "overlay on (" + EspOverlay.get().passthroughPath() + ")";
    }

    /** Debug helper used by the projection tests. */
    EspFrame frame() {
        return frame;
    }

    List<EspFrame.BoxPrim> boxes() {
        return frame.boxes();
    }
}
