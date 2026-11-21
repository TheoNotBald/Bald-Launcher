package bl.module.combat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class GrimReachTest {

    @Test
    void acceptsABoxInsideGrimsBudget() {
        assertTrue(GrimReach.withinLimit(2.6, -0.5, -0.5, 3.4, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void rejectsABoxPastTheBudget() {
        assertFalse(GrimReach.withinLimit(3.2, -0.5, -0.5, 4.0, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void boundarySitsBetweenVanillaReachAndTheFirstFlag() {
        assertTrue(GrimReach.withinLimit(3.02, -0.5, -0.5, 3.4, 0.5, 0.5, 0.0, 0.0, 0.0));
        assertFalse(GrimReach.withinLimit(3.03, -0.5, -0.5, 3.4, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void measuresEuclideanDistanceToTheNearestCorner() {
        assertTrue(GrimReach.withinLimit(2.0, 2.0, 0.0, 2.5, 2.5, 0.5, 0.0, 0.0, 0.0));
        assertFalse(GrimReach.withinLimit(2.2, 2.2, 0.0, 2.7, 2.7, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void treatsAPointInsideTheBoxAsZeroDistance() {
        assertTrue(GrimReach.withinLimit(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void rejectsInvalidCoordinates() {
        assertFalse(GrimReach.withinLimit(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, Double.NaN, 0.0, 0.0));
        assertFalse(GrimReach.withinLimit(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, Double.POSITIVE_INFINITY, 0.0));
    }
}
