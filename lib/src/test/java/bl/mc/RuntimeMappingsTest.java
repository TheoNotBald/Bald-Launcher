package bl.mc;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class RuntimeMappingsTest {

    @AfterEach
    void resetNamespace() {
        RuntimeMappings.configure(0, null);
    }

    @Test
    void resolvesMojangGuiMethodNamesInFabricNamespace() {
        RuntimeMappings.configure(1, null);

        List<String> names = RuntimeMappings.memberNames(
                "net/minecraft/class_332", "drawString", false);

        assertTrue(names.contains("method_35720"));
        assertTrue(names.contains("drawTextWithShadow"));
    }

    @Test
    void resolvesMojangMovementNamesInFabricNamespace() {
        RuntimeMappings.configure(1, null);

        List<String> methodNames = RuntimeMappings.memberNames(
                "net/minecraft/class_1297", "getDeltaMovement", false);
        List<String> fieldNames = RuntimeMappings.memberNames(
                "net/minecraft/class_1309", "noJumpDelay", true);

        assertTrue(methodNames.contains("getVelocity"));
        assertTrue(fieldNames.contains("jumpingCooldown"));
    }
}
