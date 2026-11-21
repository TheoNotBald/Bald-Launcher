package bl.mc;

/**
 * Holds a vanilla key binding down for as long as a module needs it.
 *
 * <p>The press goes through the same {@code KeyBinding} the player input is read
 * from, so the {@code ServerboundPlayerInputPacket} the server receives contains
 * the matching flag. Anything the server (and a prediction-based anticheat)
 * simulates from input therefore agrees with the movement it observes.
 */
public final class KeyHold {

    private final String[] aliases;
    private Object key;
    private boolean injected;
    private boolean wasPressed;

    public KeyHold(String... aliases) {
        this.aliases = aliases;
    }

    public void set(boolean pressed) {
        if (pressed) {
            press();
        } else {
            release();
        }
    }

    public void release() {
        Object binding = key;
        boolean owned = injected;
        key = null;
        injected = false;
        if (!owned || binding == null || wasPressed) {
            return;
        }
        wasPressed = false;
        if (!Reflect.invoke(binding, "setPressed", false)
                && !Reflect.setField(binding, "isDown", false)) {
            throw new IllegalStateException("Could not release the " + aliases[0] + " key");
        }
    }

    private void press() {
        if (injected) {
            return;
        }
        Object minecraft = Reflect.instance();
        Object options = minecraft == null ? null : Reflect.getField(minecraft, "options");
        Object binding = options == null ? null : Reflect.getFieldAny(options, aliases);
        if (binding == null) {
            throw new IllegalStateException("Could not resolve the " + aliases[0] + " key binding");
        }
        Object current = Reflect.call(binding, "isPressed");
        if (!(current instanceof Boolean)) {
            current = Reflect.call(binding, "isDown");
        }
        wasPressed = Boolean.TRUE.equals(current);
        key = binding;
        if (wasPressed) {
            return;
        }
        if (!Reflect.invoke(binding, "setPressed", true)
                && !Reflect.setField(binding, "isDown", true)) {
            throw new IllegalStateException("Could not press the " + aliases[0] + " key");
        }
        injected = true;
    }
}
