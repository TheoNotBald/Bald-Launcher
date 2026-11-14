package bl.module;

import java.util.List;
import java.util.function.BooleanSupplier;

public final class Setting {

    public enum Type {
        BOOL,
        INT,
        DOUBLE,
        ENUM,
        COLOR,
        KEY
    }

    public final String name;
    public final Type type;
    private final BooleanSupplier visibility;

    private boolean bool;
    private int number;
    private double decimal;
    private String choice;
    private int color;
    private int key;
    private int min;
    private int max;
    private double dmin;
    private double dmax;
    private List<String> options;

    private Setting(String name, Type type, BooleanSupplier visibility) {
        this.name = name;
        this.type = type;
        this.visibility = visibility;
    }

    public static Setting bool(String name, boolean value) {
        return bool(name, value, () -> true);
    }

    public static Setting bool(String name, boolean value, BooleanSupplier visibility) {
        Setting setting = new Setting(name, Type.BOOL, visibility);
        setting.bool = value;
        return setting;
    }

    public static Setting integer(String name, int value, int min, int max) {
        return integer(name, value, min, max, () -> true);
    }

    public static Setting integer(String name, int value, int min, int max, BooleanSupplier visibility) {
        if (min > max || value < min || value > max) {
            throw new IllegalArgumentException("Invalid integer setting range or default: " + name);
        }
        Setting setting = new Setting(name, Type.INT, visibility);
        setting.number = value;
        setting.min = min;
        setting.max = max;
        return setting;
    }

    public static Setting decimal(String name, double value, double min, double max) {
        return decimal(name, value, min, max, () -> true);
    }

    public static Setting decimal(String name, double value, double min, double max, BooleanSupplier visibility) {
        if (!Double.isFinite(min) || !Double.isFinite(max) || !Double.isFinite(value)
                || min > max || value < min || value > max) {
            throw new IllegalArgumentException("Invalid decimal setting range or default: " + name);
        }
        Setting setting = new Setting(name, Type.DOUBLE, visibility);
        setting.decimal = value;
        setting.dmin = min;
        setting.dmax = max;
        return setting;
    }

    public static Setting enumeration(String name, String value, List<String> options) {
        if (options == null || options.isEmpty() || !options.contains(value)) {
            throw new IllegalArgumentException("Invalid enum setting default: " + name);
        }
        Setting setting = new Setting(name, Type.ENUM, () -> true);
        setting.choice = value;
        setting.options = List.copyOf(options);
        return setting;
    }

    public static Setting enumOf(String name, Enum<?> value) {
        if (value == null) {
            throw new IllegalArgumentException("Enum setting default cannot be null: " + name);
        }
        List<String> options = new java.util.ArrayList<>();
        for (Object option : value.getDeclaringClass().getEnumConstants()) {
            options.add(((Enum<?>) option).name());
        }
        return enumeration(name, value.name(), options);
    }

    public static Setting color(String name, int value) {
        Setting setting = new Setting(name, Type.COLOR, () -> true);
        setting.color = value;
        return setting;
    }

    public static Setting key(String name, int value) {
        Setting setting = new Setting(name, Type.KEY, () -> true);
        setting.key = value;
        return setting;
    }

    public boolean visible() {
        return visibility.getAsBoolean();
    }

    public boolean getBool() {
        return bool;
    }

    public int getInt() {
        return number;
    }

    public double getDouble() {
        return decimal;
    }

    public String getEnum() {
        return choice;
    }

    public <E extends Enum<E>> E getEnum(Class<E> enumType) {
        return Enum.valueOf(enumType, choice);
    }

    public int getColor() {
        return color;
    }

    public int getKey() {
        return key;
    }

    public int getMin() {
        return min;
    }

    public int getMax() {
        return max;
    }

    public double getDMin() {
        return dmin;
    }

    public double getDMax() {
        return dmax;
    }

    public List<String> getOptions() {
        return options;
    }

    public void setBool(boolean value) {
        bool = value;
    }

    public void setInt(int value) {
        number = Math.max(min, Math.min(max, value));
    }

    public void setDouble(double value) {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("Setting value must be finite: " + name);
        }
        decimal = Math.max(dmin, Math.min(dmax, value));
    }

    public void setEnum(String value) {
        if (options == null || !options.contains(value)) {
            throw new IllegalArgumentException("Unknown option for " + name + ": " + value);
        }
        choice = value;
    }

    public void setColor(int value) {
        color = value;
    }

    public void setKey(int value) {
        if (value < 0) {
            throw new IllegalArgumentException("Key code cannot be negative: " + name);
        }
        key = value;
    }

    public String display() {
        return switch (type) {
            case BOOL -> bool ? "on" : "off";
            case INT -> String.valueOf(number);
            case DOUBLE -> String.format("%.2f", decimal);
            case ENUM -> choice;
            case COLOR -> String.format("#%06X", color & 0xFFFFFF);
            case KEY -> key == 0 ? "-" : String.valueOf(key);
        };
    }
}
