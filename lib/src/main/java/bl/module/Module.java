package bl.module;

import java.util.ArrayList;
import java.util.List;

import bl.Bl;
import bl.rotation.RotationManager;

public abstract class Module {

    public final String name;
    public final Category category;
    public final boolean singleplayerOnly;
    public final List<Setting> settings = new ArrayList<>();
    public boolean enabled;
    public int keybind;

    protected Module(String name, Category category) {
        this(name, category, false);
    }

    protected Module(String name, Category category, boolean singleplayerOnly) {
        this.name = name;
        this.category = category;
        this.singleplayerOnly = singleplayerOnly;
    }

    protected Setting setting(Setting setting) {
        settings.add(setting);
        return setting;
    }

    public void toggle() {
        if (enabled) {
            disable();
        } else {
            enable();
        }
    }

    public void enable() {
        if (enabled) {
            return;
        }
        enabled = true;
        Module previous = Bl.activate(this);
        try {
            onEnable();
        } catch (Throwable t) {
            fail(t);
        } finally {
            Bl.restoreActive(previous);
        }
    }

    public void disable() {
        if (!enabled) {
            return;
        }
        enabled = false;
        Module previous = Bl.activate(this);
        try {
            onDisable();
        } catch (Throwable t) {
            Bl.reportFailure(name + " disable", t);
        } finally {
            Bl.restoreActive(previous);
        }
    }

    public void fail(Throwable error) {
        if (!enabled) {
            Bl.reportFailure(name, error);
            return;
        }
        enabled = false;
        Module previous = Bl.activate(this);
        try {
            onDisable();
        } catch (Throwable cleanupError) {
            error.addSuppressed(cleanupError);
        } finally {
            Bl.restoreActive(previous);
        }
        Bl.reportFailure(name, error);
    }

    @Deprecated
    public void disableQuietly() {
        enabled = false;
    }

    public void tick() {
        if (enabled && !runsAfterVanillaTick()) {
            onTick();
        }
    }

    public void tickPost() {
        if (enabled && runsAfterVanillaTick()) {
            onTick();
        }
    }

    public final boolean isAvailable() {
        return true;
    }

    protected void onEnable() {
    }

    protected void onDisable() {
    }

    protected void onUnavailable() {
    }

    protected boolean runsAfterVanillaTick() {
        return false;
    }

    protected abstract void onTick();

    protected RotationManager rotations() {
        return Bl.rotations();
    }

    public String label() {
        return name;
    }
}
