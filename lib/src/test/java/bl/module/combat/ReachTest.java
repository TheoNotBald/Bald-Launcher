package bl.module.combat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ReachTest {

    @Test
    void grimMeasuresEveryHit() {
        assertTrue(Reach.checked("Grim", false, false));
        assertTrue(Reach.checked("Grim", true, true));
    }

    @Test
    void rawNeverClamps() {
        assertFalse(Reach.checked("Raw", false, false));
        assertFalse(Reach.checked("Raw", true, true));
    }

    @Test
    void mountedOnlyOpensUpWhileGrimSkipsTheCheck() {
        assertTrue(Reach.checked("Mounted", false, false));
        assertFalse(Reach.checked("Mounted", true, false));
        assertFalse(Reach.checked("Mounted", false, true));
    }
}
