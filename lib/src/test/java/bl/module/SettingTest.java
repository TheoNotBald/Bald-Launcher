package bl.module;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class SettingTest {

    @Test
    void clampsNumericValuesToConfiguredRange() {
        Setting setting = Setting.integer("Delay", 5, 0, 10);

        setting.setInt(20);

        assertEquals(10, setting.getInt());
    }

    @Test
    void rejectsNonFiniteDecimalValues() {
        Setting setting = Setting.decimal("Speed", 1.0, 0.0, 2.0);

        assertThrows(IllegalArgumentException.class, () -> setting.setDouble(Double.NaN));
    }
}
