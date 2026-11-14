package bl.module;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import bl.Bl;
import bl.AgentLock;
import bl.rotation.RotationManager;

public abstract class Module {

    public final String name;
    public final String title;
    public final String description;
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
        this.title = titleOf(name);
        this.description = DESCRIPTIONS.getOrDefault(name, "");
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
        if (enabled || AgentLock.isLocked()) {
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
        return title;
    }

    private static String titleOf(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        StringBuilder result = new StringBuilder(value.length() + 4);
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (index > 0 && Character.isUpperCase(character)) {
                char previous = value.charAt(index - 1);
                if (Character.isLowerCase(previous) || Character.isDigit(previous)) {
                    result.append(' ');
                }
            }
            result.append(character);
        }
        return result.toString();
    }

    private static final Map<String, String> DESCRIPTIONS = Map.ofEntries(
            Map.entry("AimAssist", "Automatically aims at entities."),
            Map.entry("AutoClicker", "Automatically clicks while you hold attack."),
            Map.entry("AutoShield", "Automatically raises your shield."),
            Map.entry("AutoWeapon", "Finds the best weapon in your hotbar."),
            Map.entry("BowAim", "Automatically aims your bow."),
            Map.entry("Criticals", "Performs critical attacks."),
            Map.entry("Hitboxes", "Expands entity hitboxes."),
            Map.entry("KillAura", "Attacks entities around you."),
            Map.entry("Reach", "Extends your reach."),
            Map.entry("TriggerBot", "Attacks the entity you are looking at."),
            Map.entry("Velocity", "Reduces or removes knockback."),
            Map.entry("AutoArmor", "Automatically equips the best armor."),
            Map.entry("AutoTotem", "Automatically equips a totem in your offhand."),
            Map.entry("AirJump", "Lets you jump in mid-air."),
            Map.entry("AntiWeb", "Prevents cobwebs from slowing you down."),
            Map.entry("AutoSprint", "Automatically sprints."),
            Map.entry("AutoSwim", "Automatically swims."),
            Map.entry("FastLadder", "Climbs ladders faster."),
            Map.entry("Flight", "Allows you to fly."),
            Map.entry("LongJump", "Jumps farther."),
            Map.entry("NoFall", "Prevents fall damage."),
            Map.entry("NoJumpDelay", "Removes the jump cooldown."),
            Map.entry("NoSlow", "Prevents items from slowing you down."),
            Map.entry("Parkour", "Automatically jumps across gaps."),
            Map.entry("ReverseStep", "Pulls you down quickly."),
            Map.entry("SafeWalk", "Prevents you from walking off edges."),
            Map.entry("Speed", "Makes you move faster."),
            Map.entry("Spider", "Climbs walls."),
            Map.entry("Sprint", "Automatically sprints."),
            Map.entry("Step", "Allows you to step up blocks."),
            Map.entry("AutoEat", "Automatically eats food."),
            Map.entry("AutoFish", "Automatically fishes."),
            Map.entry("AutoLoot", "Automatically collects loot."),
            Map.entry("AutoRespawn", "Automatically respawns."),
            Map.entry("AutoTool", "Automatically selects the best tool."),
            Map.entry("BlockESP", "Highlights blocks."),
            Map.entry("ESP", "Highlights entities."),
            Map.entry("ItemESP", "Highlights items."),
            Map.entry("Nametags", "Renders better nametags."),
            Map.entry("Tracers", "Draws lines to entities."),
            Map.entry("AutoFarm", "Automatically farms crops."),
            Map.entry("AutoMine", "Automatically mines blocks."),
            Map.entry("AutoReplant", "Replants crops."),
            Map.entry("FastPlace", "Places blocks faster."),
            Map.entry("SpeedMine", "Mines blocks faster."),
            Map.entry("TreeFeller", "Breaks entire trees."),
            Map.entry("FastBreak", "Breaks blocks faster."),
            Map.entry("Timer", "Changes the game speed."),
            Map.entry("AutoWalk", "Automatically walks forward."),
            Map.entry("AutoJump", "Automatically jumps."),
            Map.entry("HoldSneak", "Holds the sneak key."),
            Map.entry("HoldSprint", "Holds the sprint key."),
            Map.entry("HoldUse", "Holds the use key."));
}
