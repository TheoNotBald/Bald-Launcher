package bl.mc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class WorldsTest {

    @Test
    void readsFallDistanceFromEntityField() {
        SampleEntity entity = new SampleEntity();
        entity.fallDistance = 2.75;

        assertEquals(2.75, Worlds.fallDistance(entity));
    }

    @Test
    void returnsNonFiniteValueWhenFallDistanceIsUnavailable() {
        assertTrue(Double.isNaN(Worlds.fallDistance(new Object())));
    }

    @Test
    void readsVerticalVelocityFromVectorField() {
        assertEquals(-0.4, Worlds.verticalVelocity(new SampleMovingEntity()));
    }

    private static final class SampleEntity {
        public double fallDistance;
    }

    private static final class SampleMovingEntity {
        public SampleVector getDeltaMovement() {
            return new SampleVector(-0.4);
        }
    }

    private static final class SampleVector {
        public final double y;

        private SampleVector(double y) {
            this.y = y;
        }
    }
}
