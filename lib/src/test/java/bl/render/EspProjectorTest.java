package bl.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class EspProjectorTest {

    private static final float[] IDENTITY = {
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
    };

    /** Perspective-style matrix whose w is the view-space z. */
    private static final float[] DEPTH = {
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 1, 0,
    };

    @Test
    void centreProjectsToScreenCentre() {
        EspProjector projector = new EspProjector(IDENTITY, IDENTITY, 800, 600);
        float[] out = new float[4];
        assertTrue(projector.point(0.0, 0.0, 0.0, out));
        assertEquals(400.0f, out[0], 0.001f);
        assertEquals(300.0f, out[1], 0.001f);
    }

    @Test
    void rightAndUpMapToScreenAxes() {
        EspProjector projector = new EspProjector(IDENTITY, IDENTITY, 800, 600);
        float[] out = new float[4];
        assertTrue(projector.point(0.5, 0.5, 0.0, out));
        assertEquals(600.0f, out[0], 0.001f);
        assertEquals(150.0f, out[1], 0.001f);
    }

    @Test
    void projectsTheCombinedViewProjection() {
        float[] view = {
                1, 0, 0, -2,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
        };
        EspProjector projector = new EspProjector(view, IDENTITY, 800, 600);
        float[] out = new float[4];
        // World x = 2 with the camera translated to x = 2 must land in the centre.
        assertTrue(projector.point(2.0, 0.0, 0.0, out));
        assertEquals(400.0f, out[0], 0.001f);
    }

    @Test
    void segmentCrossingTheNearPlaneIsClippedInsteadOfInverted() {
        EspProjector projector = new EspProjector(DEPTH, DEPTH, 800, 600);
        float[] out = new float[4];
        assertTrue(projector.segment(0.0, 0.0, -1.0, 0.0, 0.0, 1.0, out));
        assertEquals(400.0f, out[0], 0.01f);
        assertEquals(300.0f, out[1], 0.01f);
        assertEquals(400.0f, out[2], 0.01f);
        assertEquals(300.0f, out[3], 0.01f);
    }

    @Test
    void segmentFullyBehindTheCameraIsDropped() {
        EspProjector projector = new EspProjector(DEPTH, DEPTH, 800, 600);
        float[] out = new float[4];
        assertFalse(projector.segment(0.0, 0.0, -2.0, 0.0, 0.0, -1.0, out));
    }

    @Test
    void boxesOutsideTheFrustumAreRejected() {
        EspProjector projector = new EspProjector(IDENTITY, IDENTITY, 800, 600);
        assertTrue(projector.visible(new float[] { -0.2f, -0.2f, -0.2f, 0.2f, 0.2f, 0.2f }));
        assertFalse(projector.visible(new float[] { 4.0f, -0.2f, -0.2f, 6.0f, 0.2f, 0.2f }));
        assertFalse(projector.visible(new float[] { -0.2f, 4.0f, -0.2f, 0.2f, 6.0f, 0.2f }));
    }

    @Test
    void boxBehindTheCameraIsRejected() {
        EspProjector projector = new EspProjector(DEPTH, DEPTH, 800, 600);
        assertFalse(projector.visible(new float[] { -0.2f, -0.2f, -6.0f, 0.2f, 0.2f, -4.0f }));
    }

    @Test
    void partiallyVisibleBoxStillDraws() {
        EspProjector projector = new EspProjector(IDENTITY, IDENTITY, 800, 600);
        assertTrue(projector.visible(new float[] { 0.8f, -0.1f, -0.1f, 1.8f, 0.1f, 0.1f }));
    }
}
