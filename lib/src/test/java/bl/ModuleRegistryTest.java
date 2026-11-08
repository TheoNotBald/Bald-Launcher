package bl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

class ModuleRegistryTest {

    @Test
    void exposesRequestedTargetAndTimerSettings() {
        Bl.init();

        assertNotNull(setting("AimAssist", "Target players"));
        assertNotNull(setting("AimAssist", "Target hostile mobs"));
        assertNotNull(setting("BowAim", "Target players"));
        assertNotNull(setting("BowAim", "Target hostile mobs"));
        var timerSpeed = setting("Timer", "Speed");
        assertNotNull(timerSpeed);
        assertEquals(0.0, timerSpeed.getDMin());
        assertEquals(20.0, timerSpeed.getDMax());
    }

    @Test
    void registersAtLeastFiftyUniqueModules() {
        Bl.init();

        Set<String> names = new HashSet<>();
        for (var module : Bl.modules()) {
            assertTrue(names.add(module.name), "Duplicate module name: " + module.name);
        }
        assertEquals(Bl.modules().size(), names.size());
        assertTrue(names.size() >= 51, "Expected at least 51 registered modules");
        assertFalse(names.contains("NoFall"), "NoFall is intentionally excluded from this agent build");
        assertTrue(names.containsAll(Set.of("SpeedMine", "BlockESP", "ESP", "Tracers", "Nametags", "ItemESP", "AutoTotem",
                "AutoArmor", "AutoFish", "AutoLoot", "AutoFarm", "TreeFeller", "AutoReplant",
                "AutoMine", "AirJump", "NoSlow", "Spider", "AimAssist", "AutoWeapon", "AutoShield", "BowAim")));
        assertTrue(names.stream().noneMatch(name -> name.startsWith("No")
                && Set.of("NoVignette", "NoClouds", "NoVSync", "NoHurtCam").contains(name)));
    }

    private static bl.module.Setting setting(String moduleName, String settingName) {
        return Bl.modules().stream()
                .filter(module -> module.name.equals(moduleName))
                .flatMap(module -> module.settings.stream())
                .filter(setting -> setting.name.equals(settingName))
                .findFirst()
                .orElse(null);
    }
}
