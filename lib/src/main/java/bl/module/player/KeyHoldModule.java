package bl.module.player;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;

public final class KeyHoldModule extends Module {

    private final String keyName;
    private Object key;
    private Boolean originalDown;

    public KeyHoldModule(String name, String keyName) {
        super(name, Category.MOVEMENT, true);
        this.keyName = keyName;
    }

    @Override
    protected void onTick() {
        Object options = Reflect.getField(Reflect.instance(), "options");
        Object currentKey = Reflect.getField(options, keyName);
        if (currentKey == null) {
            throw new IllegalStateException("Could not resolve the " + keyName + " key binding");
        }
        if (currentKey != key) {
            restore();
            key = currentKey;
            Object down = Reflect.call(key, "isDown");
            if (!(down instanceof Boolean value)) {
                throw new IllegalStateException("Could not read the " + keyName + " key state");
            }
            originalDown = value;
        }
        if (!Reflect.invoke(key, "setDown", true)) {
            throw new IllegalStateException("Could not hold the " + keyName + " key");
        }
    }

    @Override
    protected void onDisable() {
        restore();
    }

    @Override
    protected void onUnavailable() {
        restore();
    }

    private void restore() {
        if (key != null && originalDown != null && !Reflect.invoke(key, "setDown", originalDown)) {
            throw new IllegalStateException("Could not restore the " + keyName + " key state");
        }
        key = null;
        originalDown = null;
    }
}
