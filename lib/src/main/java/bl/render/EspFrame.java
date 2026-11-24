package bl.render;

import java.util.ArrayList;
import java.util.List;

/**
 * World-space primitives collected during one frame plus their projection into
 * an {@link EspSnapshot}. Nothing here caches geometry: the frame is rebuilt
 * from the live entities every time it is drawn.
 */
public final class EspFrame {

    public static final class BoxPrim {
        public final float[] bounds;
        public final int color;
        public final boolean throughWalls;

        BoxPrim(float[] bounds, int color, boolean throughWalls) {
            this.bounds = bounds;
            this.color = color;
            this.throughWalls = throughWalls;
        }
    }

    public static final class LinePrim {
        public final float[] points;
        public final int color;
        public final float width;
        public final boolean throughWalls;

        LinePrim(float[] points, int color, float width, boolean throughWalls) {
            this.points = points;
            this.color = color;
            this.width = width;
            this.throughWalls = throughWalls;
        }
    }

    public static final class LabelPrim {
        public final float[] anchor;
        public final Object entity;
        public final int yOffset;
        public final String text;
        public final int color;
        public final int background;
        public final float scale;

        LabelPrim(float[] anchor, Object entity, int yOffset, String text,
                int color, int background, float scale) {
            this.anchor = anchor;
            this.entity = entity;
            this.yOffset = yOffset;
            this.text = text;
            this.color = color;
            this.background = background;
            this.scale = scale;
        }
    }

    public static final class TracerPrim {
        public final float[] target;
        public final int color;
        public final float width;

        TracerPrim(float[] target, int color, float width) {
            this.target = target;
            this.color = color;
            this.width = width;
        }
    }

    private static final int[][] BOX_EDGES = {
            { 0, 1 }, { 1, 3 }, { 3, 2 }, { 2, 0 },
            { 4, 5 }, { 5, 7 }, { 7, 6 }, { 6, 4 },
            { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 },
    };

    private final List<BoxPrim> boxes = new ArrayList<>();
    private final List<LinePrim> lines = new ArrayList<>();
    private final List<LabelPrim> labels = new ArrayList<>();
    private final List<TracerPrim> tracers = new ArrayList<>();

    private final float[] screen = new float[4];

    public void clear() {
        boxes.clear();
        lines.clear();
        labels.clear();
        tracers.clear();
    }

    public boolean isEmpty() {
        return boxes.isEmpty() && lines.isEmpty() && labels.isEmpty() && tracers.isEmpty();
    }

    public List<BoxPrim> boxes() {
        return boxes;
    }

    public List<LinePrim> lines() {
        return lines;
    }

    public List<LabelPrim> labels() {
        return labels;
    }

    public List<TracerPrim> tracers() {
        return tracers;
    }

    public void box(float minX, float minY, float minZ, float maxX, float maxY, float maxZ,
            int color, boolean throughWalls) {
        if (color == 0 || maxX - minX < 0.0f || maxY - minY < 0.0f || maxZ - minZ < 0.0f) {
            return;
        }
        boxes.add(new BoxPrim(new float[] { minX, minY, minZ, maxX, maxY, maxZ }, color, throughWalls));
    }

    public void line(float x1, float y1, float z1, float x2, float y2, float z2,
            int color, float width, boolean throughWalls) {
        if (color == 0) {
            return;
        }
        lines.add(new LinePrim(new float[] { x1, y1, z1, x2, y2, z2 }, color, width, throughWalls));
    }

    public void tracer(float x, float y, float z, int color, float width) {
        if (color == 0) {
            return;
        }
        tracers.add(new TracerPrim(new float[] { x, y, z }, color, width));
    }

    public void label(Object entity, int yOffset, float x, float y, float z,
            String text, int color, int background, float scale) {
        if (text == null || text.isEmpty() || color == 0) {
            return;
        }
        labels.add(new LabelPrim(new float[] { x, y, z }, entity, yOffset, text, color, background,
                Math.max(0.5f, Math.min(8.0f, scale))));
    }

    public EspSnapshot snapshot(EspProjector projector) {
        int width = projector.width();
        int height = projector.height();
        if (width <= 0 || height <= 0) {
            return EspSnapshot.EMPTY;
        }
        List<float[]> geometry = new ArrayList<>();
        List<Integer> geometryColors = new ArrayList<>();
        List<EspSnapshot.Label> projectedLabels = new ArrayList<>();

        for (BoxPrim box : boxes) {
            if (!projector.visible(box.bounds)) {
                continue;
            }
            float[] bounds = box.bounds;
            for (int[] edge : BOX_EDGES) {
                float[] min = corner(bounds, edge[0]);
                float[] max = corner(bounds, edge[1]);
                if (projector.segment(min[0], min[1], min[2], max[0], max[1], max[2], screen)) {
                    addSegment(geometry, geometryColors, screen[0], screen[1], screen[2], screen[3],
                            EspPalette.LINE_WIDTH, box.color);
                }
            }
        }

        for (LinePrim line : lines) {
            float[] points = line.points;
            if (projector.segment(points[0], points[1], points[2], points[3], points[4], points[5], screen)) {
                addSegment(geometry, geometryColors, screen[0], screen[1], screen[2], screen[3],
                        line.width, line.color);
            }
        }

        for (TracerPrim tracer : tracers) {
            float[] target = tracer.target;
            if (!projector.point(target[0], target[1], target[2], screen)) {
                continue;
            }
            float startX = width * 0.5f;
            float startY = height - 1.0f;
            if (Math.abs(screen[0] - startX) < 0.01f && Math.abs(screen[1] - startY) < 0.01f) {
                continue;
            }
            addSegment(geometry, geometryColors, startX, startY, screen[0], screen[1],
                    tracer.width, tracer.color);
        }

        float pad = 22.0f;
        for (LabelPrim label : labels) {
            float[] anchor = label.anchor;
            if (!projector.point(anchor[0], anchor[1], anchor[2], screen)) {
                continue;
            }
            float textWidth = BitmapFont.width(label.text, label.scale);
            float textHeight = BitmapFont.height(label.scale);
            float centerX = clamp(screen[0], pad + textWidth * 0.5f, width - pad - textWidth * 0.5f);
            float top = clamp(screen[1] - textHeight - label.scale, pad, height - pad - textHeight);
            projectedLabels.add(new EspSnapshot.Label(centerX, top, label.scale,
                    label.color, label.background, label.text));
        }

        if (geometry.isEmpty() && projectedLabels.isEmpty()) {
            return new EspSnapshot(width, height, new float[0], new int[0], new EspSnapshot.Label[0]);
        }
        float[] segments = new float[geometry.size() * 5];
        int[] colors = new int[geometryColors.size()];
        for (int index = 0; index < geometry.size(); index++) {
            System.arraycopy(geometry.get(index), 0, segments, index * 5, 5);
        }
        for (int index = 0; index < colors.length; index++) {
            colors[index] = geometryColors.get(index);
        }
        return new EspSnapshot(width, height, segments, colors,
                projectedLabels.toArray(new EspSnapshot.Label[0]));
    }

    private static float clamp(float value, float min, float max) {
        if (max < min) {
            return (min + max) * 0.5f;
        }
        return Math.max(min, Math.min(max, value));
    }

    private static void addSegment(List<float[]> geometry, List<Integer> colors,
            float x1, float y1, float x2, float y2, float width, int color) {
        if (!(Float.isFinite(x1) && Float.isFinite(y1) && Float.isFinite(x2) && Float.isFinite(y2))) {
            return;
        }
        geometry.add(new float[] { x1, y1, x2, y2, Math.max(1.0f, Math.min(8.0f, width)) });
        colors.add(color);
    }

    private static final float[][] CORNERS = new float[8][3];

    private static float[] corner(float[] bounds, int index) {
        float[] corner = CORNERS[index];
        corner[0] = (index & 1) == 0 ? bounds[0] : bounds[3];
        corner[1] = (index & 2) == 0 ? bounds[1] : bounds[4];
        corner[2] = (index & 4) == 0 ? bounds[2] : bounds[5];
        return corner;
    }
}
