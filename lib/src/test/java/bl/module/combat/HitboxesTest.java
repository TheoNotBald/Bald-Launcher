package bl.module.combat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class HitboxesTest {

    @Test
    void allowsExpansionWhenExpandedBoxRemainsWithinVanillaReach() {
        assertTrue(Hitboxes.isWithinReach(3.2, -0.5, -0.5, 4.0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void rejectsExpansionWhenExpandedBoxStillExceedsVanillaReach() {
        assertFalse(Hitboxes.isWithinReach(3.6, -0.5, -0.5, 4.0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void measuresReachToTheExpandedCornerUsingEuclideanDistance() {
        assertTrue(Hitboxes.isWithinReach(2.5, 2.5, 0.0, 3.0, 3.0, 0.5, 0.5, 0.0, 0.0, 0.0));
    }

    @Test
    void rejectsInvalidCoordinatesAndExpansion() {
        assertFalse(Hitboxes.isWithinReach(0.0, 0.0, 0.0, 1.0, 1.0, 1.0,
                Double.NaN, 0.0, 0.0, 0.0));
        assertFalse(Hitboxes.isWithinReach(0.0, 0.0, 0.0, 1.0, 1.0, 1.0,
                0.5, Double.POSITIVE_INFINITY, 0.0, 0.0));
    }
}
