package bl;

import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import bl.agent.Patcher;
import bl.event.EventBus;
import bl.event.events.AttackEvent;
import bl.event.events.BlockQueryEvent;
import bl.event.events.EyeHeightEvent;
import bl.event.events.Render2DEvent;
import bl.event.events.RenderLevelEvent;
import bl.event.events.ReceiveMotionEvent;
import bl.event.events.SendPacketEvent;
import bl.event.events.SendPositionEvent;
import bl.event.events.SetScreenEvent;
import bl.event.events.TickEvent;
import bl.event.events.UseItemEvent;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.module.combat.AimAssist;
import bl.module.combat.AutoShield;
import bl.module.combat.AutoWeapon;
import bl.module.combat.BowAim;
import bl.module.combat.AutoClicker;
import bl.module.combat.Criticals;
import bl.module.combat.KillAura;
import bl.module.combat.Reach;
import bl.module.combat.TriggerBot;
import bl.module.combat.Velocity;
import bl.module.movement.Flight;
import bl.module.movement.AirJump;
import bl.module.movement.AntiWeb;
import bl.module.movement.AutoSprint;
import bl.module.movement.AutoSwim;
import bl.module.movement.FastLadder;
import bl.module.movement.FastBreak;
import bl.module.movement.LongJump;
import bl.module.movement.NoJumpDelay;
import bl.module.movement.NoSlow;
import bl.module.movement.Parkour;
import bl.module.movement.ReverseStep;
import bl.module.movement.SafeWalk;
import bl.module.movement.Speed;
import bl.module.movement.Spider;
import bl.module.movement.Sprint;
import bl.module.movement.Step;
import bl.module.movement.Timer;
import bl.module.player.AutoRespawn;
import bl.module.player.AutoArmor;
import bl.module.player.AutoEat;
import bl.module.player.AutoFish;
import bl.module.player.AutoLoot;
import bl.module.player.AutoTool;
import bl.module.player.AutoTotem;
import bl.module.player.KeyHoldModule;
import bl.module.render.ESP;
import bl.module.render.ItemESP;
import bl.module.render.BlockESP;
import bl.module.render.Nametags;
import bl.module.render.Tracers;
import bl.module.world.FastPlace;
import bl.module.world.AutoFarm;
import bl.module.world.AutoMine;
import bl.module.world.AutoReplant;
import bl.module.world.SpeedMine;
import bl.module.world.TreeFeller;
import bl.rotation.RotationManager;
import bl.ui.ClickGui;

public final class Bl {

    public static volatile boolean debug = Boolean.getBoolean("lib.debug");

    private static Bl instance;

    private final EventBus bus = new EventBus();
    private final RotationManager rotations = new RotationManager();
    private final List<Module> modules = new ArrayList<>();
    private final ClickGui gui = new ClickGui();

    private volatile Object connection;
    private volatile Object minecraft;
    private Module active;
    private boolean configurationLoaded;
    private String activeProfile = "default";

    private Bl() {
    }

    public static void init() {
        if (instance != null) {
            return;
        }
        instance = new Bl();
        instance.register();
    }

    public static Bl get() {
        return instance;
    }

    public static void attach(Patcher patcher) {
    }

    public static EventBus bus() {
        return instance.bus;
    }

    public static RotationManager rotations() {
        return instance.rotations;
    }

    public static ClickGui gui() {
        return instance.gui;
    }

    public static List<Module> modules() {
        return instance.modules;
    }

    public static Object connection() {
        return instance == null ? null : instance.connection;
    }

    public static Object minecraft() {
        return instance == null ? null : instance.minecraft;
    }

    public static void fault(Throwable throwable) {
        Module module = instance == null ? null : instance.active;
        if (module != null && module.enabled) {
            module.fail(throwable);
            return;
        }
        reportFailure("Agent", throwable);
    }

    public static void reportFailure(String source, Throwable throwable) {
        System.err.println("[Bald Agent] " + source + " failed: " + throwable);
        if (debug) {
            throwable.printStackTrace(System.err);
        }
    }

    public static Module activate(Module module) {
        if (instance == null) {
            return null;
        }
        Module previous = instance.active;
        instance.active = module;
        return previous;
    }

    public static void restoreActive(Module previous) {
        if (instance != null) {
            instance.active = previous;
        }
    }

    private void register() {
        add(new KillAura(), new Reach(), new Velocity(), new AutoClicker(), new Criticals(), new TriggerBot(),
                new AimAssist(), new AutoWeapon(), new AutoShield(), new BowAim());
        add(new Sprint(), new Step(), new Speed(), new Flight(), new LongJump(), new SafeWalk(),
                new Timer(), new AutoSprint(), new AirJump(), new NoJumpDelay(), new Spider(), new ReverseStep(),
                new NoSlow(), new Parkour(), new AutoSwim(), new FastLadder(), new AntiWeb());
        add(new AutoRespawn(), new FastPlace());
        add(new AutoEat(), new AutoTool(), new AutoArmor(), new AutoTotem(), new AutoFish(), new AutoLoot());
        add(new FastBreak(), new SpeedMine(), new AutoMine(), new AutoFarm(), new TreeFeller(), new AutoReplant(),
                new KeyHoldModule("AutoWalk", "keyUp"),
                new KeyHoldModule("AutoJump", "keyJump"), new KeyHoldModule("HoldSneak", "keyShift"),
                new KeyHoldModule("HoldSprint", "keySprint"), new KeyHoldModule("HoldUse", "keyUse"));
        add(new ESP(), new Tracers(), new Nametags(), new ItemESP(), new BlockESP());

        bus.subscribe(SetScreenEvent.class, event -> {
            if (event.screen == null) {
                rotations.reset();
            }
        });
    }

    private void add(Module... entries) {
        for (Module module : entries) {
            modules.add(module);
        }
    }

    public static void tick() {
        try {
            if (instance == null) {
                return;
            }
            instance.minecraft = bl.mc.Reflect.instance();
            if (!instance.configurationLoaded) {
                instance.loadConfiguration();
            }
            instance.rotations.tick();
            instance.gui.tick();
            for (Module module : new ArrayList<>(instance.modules)) {
                if (!module.enabled) {
                    continue;
                }
                instance.active = module;
                try {
                    module.tick();
                } catch (Throwable t) {
                    fault(t);
                } finally {
                    instance.active = null;
                }
            }
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void postTick() {
        if (instance == null) {
            return;
        }
        for (Module module : new ArrayList<>(instance.modules)) {
            if (!module.enabled) {
                continue;
            }
            instance.active = module;
            try {
                module.tickPost();
            } catch (Throwable t) {
                fault(t);
            } finally {
                instance.active = null;
            }
        }
    }

    public static void setScreen(Object screen) {
        try {
            instance.bus.post(new SetScreenEvent(screen));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void attack(Object player, Object target) {
        try {
            instance.bus.post(new AttackEvent(target));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void attackIntercept(Object gameMode, Object player, Object target) {
        if (instance != null) {
            for (Module module : instance.modules) {
                if (module instanceof Criticals criticals && module.enabled
                        && criticals.interceptAttack(gameMode, player, target)) {
                    return;
                }
            }
        }
        if (gameMode == null || !bl.mc.Reflect.invoke(gameMode, "bald$originalAttack", player, target)) {
            throw new IllegalStateException("Could not invoke original Minecraft attack method");
        }
    }

    public static void useItemOn(Object mode, Object player, Object hand, Object hit) {
        try {
            instance.bus.post(new UseItemEvent(hand, hit));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static boolean onSendFromListener(Object listener, Object packet) {
        try {
            instance.connection = bl.mc.Reflect.connectionOf(listener);
            return false;
        } catch (Throwable t) {
            fault(t);
            return false;
        }
    }

    public static boolean onSendFromConnection(Object connection, Object packet) {
        try {
            SendPacketEvent event = new SendPacketEvent(connection, packet);
            instance.bus.post(event);
            return event.cancelled;
        } catch (Throwable t) {
            fault(t);
            return false;
        }
    }

    public static void onReceiveMotion(Object packet) {
        try {
            if (instance != null && packet != null) {
                instance.bus.post(new ReceiveMotionEvent(packet));
            }
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void onSendPosition() {
        try {
            SendPositionEvent event = new SendPositionEvent();
            instance.bus.post(event);
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void renderLevel(Object renderer) {
        if (instance == null || renderer == null) {
            return;
        }
        try {
            instance.bus.post(new RenderLevelEvent(renderer));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void renderScreen(Object renderer) {
        try {
            instance.bus.post(new Render2DEvent(renderer));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void onKey(Object source, int keyCode, int action, int namespace) {
        try {
            if (instance == null || action != 1) {
                return;
            }
            if (keyCode == 344) {
                System.out.println("[Bald Agent] Right Shift received by agent");
                instance.gui.toggle(source, namespace);
                return;
            }
            if (instance.gui.isOpen()) {
                return;
            }
            for (Module module : instance.modules) {
                if (module.keybind != 0 && module.keybind == keyCode) {
                    module.toggle();
                    saveConfiguration();
                }
            }
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static int moduleCount() {
        return instance == null ? 0 : instance.modules.size();
    }

    public static String menuRow(int index) {
        if (instance == null || index < 0 || index >= instance.modules.size()) {
            return "";
        }
        Module module = instance.modules.get(index);
        return (module.enabled ? "[ON]  " : "[OFF] ") + module.name;
    }

    public static void renderMenu(Object screen, Object graphics, int mouseX, int mouseY, float delta) {
        if (instance != null) {
            instance.gui.render(screen, graphics, mouseX, mouseY, delta);
        }
    }

    public static void clickMenu(Object screen, Object event) {
        if (instance != null) {
            instance.gui.click(screen, event);
        }
    }

    public static boolean dragMenu(Object screen, Object event) {
        return instance != null && instance.gui.mouseDragged(event);
    }

    public static boolean releaseMenu(Object screen, Object event) {
        return instance != null && instance.gui.mouseReleased();
    }

    public static boolean keyMenu(Object screen, Object event) {
        return instance != null && instance.gui.keyPressed(event);
    }

    public static void saveConfiguration() {
        if (instance != null) {
            instance.persistConfiguration();
        }
    }

    public static void disableAllModules() {
        if (instance == null) {
            return;
        }
        for (Module module : new ArrayList<>(instance.modules)) {
            module.disable();
        }
        instance.rotations.reset();
    }

    public static void reloadConfiguration() {
        if (instance != null) {
            instance.loadConfiguration();
        }
    }

    public static String currentProfile() {
        return instance == null ? "default" : instance.activeProfile;
    }

    public static List<String> profiles() {
        return instance == null ? List.of("default") : instance.listProfiles();
    }

    public static void cycleProfile() {
        if (instance == null) {
            return;
        }
        List<String> profiles = instance.listProfiles();
        int current = profiles.indexOf(instance.activeProfile);
        instance.activeProfile = profiles.get((current + 1 + profiles.size()) % profiles.size());
        instance.loadConfiguration();
    }

    public static void createProfile() {
        if (instance != null) {
            instance.createProfileInternal();
        }
    }

    private Path profilesDirectory() {
        return Path.of(System.getProperty("user.home"), ".bald-agent", "profiles");
    }

    private Path configurationFile(String profile) {
        return profilesDirectory().resolve(profile + ".properties");
    }

    private List<String> listProfiles() {
        Set<String> names = new TreeSet<>();
        names.add("default");
        Path directory = profilesDirectory();
        if (!Files.isDirectory(directory)) {
            return new ArrayList<>(names);
        }
        try (var files = Files.list(directory)) {
            files.filter(Files::isRegularFile)
                    .map(path -> path.getFileName().toString())
                    .filter(name -> name.endsWith(".properties"))
                    .map(name -> name.substring(0, name.length() - ".properties".length()))
                    .filter(Bl::validProfileName)
                    .forEach(names::add);
        } catch (IOException error) {
            reportFailure("List configuration profiles in " + directory, error);
        }
        return new ArrayList<>(names);
    }

    private static boolean validProfileName(String profile) {
        return profile != null && profile.matches("[A-Za-z0-9_-]{1,32}");
    }

    private void createProfileInternal() {
        List<String> profiles = listProfiles();
        int suffix = 1;
        String profile;
        do {
            profile = "profile-" + suffix++;
        } while (profiles.contains(profile));
        activeProfile = profile;
        persistConfiguration();
    }

    private void persistConfiguration() {
        Properties properties = new Properties();
        for (Module module : modules) {
            String prefix = "module." + module.name + ".";
            properties.setProperty(prefix + "enabled", Boolean.toString(module.enabled));
            properties.setProperty(prefix + "keybind", Integer.toString(module.keybind));
            for (Setting setting : module.settings) {
                properties.setProperty(prefix + "setting." + setting.name, settingValue(setting));
            }
        }
        Path file = configurationFile(activeProfile);
        Path temporary = null;
        try {
            Files.createDirectories(file.getParent());
            temporary = Files.createTempFile(file.getParent(), activeProfile + "-", ".tmp");
            try (var output = Files.newOutputStream(temporary)) {
                properties.store(output, "Bald Agent module configuration");
            }
            try {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException error) {
            reportFailure("Save configuration profile to " + file, error);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException error) {
                    reportFailure("Remove temporary configuration file " + temporary, error);
                }
            }
        }
    }

    private void loadConfiguration() {
        Path file = configurationFile(activeProfile);
        if (!Files.isRegularFile(file) && activeProfile.equals("default")) {
            Path legacyFile = Path.of(System.getProperty("user.home"), ".bald-agent", "default.properties");
            if (Files.isRegularFile(legacyFile)) {
                file = legacyFile;
            }
        }
        if (!Files.isRegularFile(file)) {
            configurationLoaded = true;
            return;
        }
        Properties properties = new Properties();
        try (var input = Files.newInputStream(file)) {
            properties.load(input);
        } catch (IOException error) {
            reportFailure("Load configuration profile from " + file, error);
            configurationLoaded = true;
            return;
        }
        for (Module module : modules) {
            module.disable();
        }
        for (Module module : modules) {
            String prefix = "module." + module.name + ".";
            String keybind = properties.getProperty(prefix + "keybind");
            if (keybind != null) {
                try {
                    module.keybind = Integer.parseInt(keybind);
                } catch (NumberFormatException error) {
                    reportInvalidSetting(prefix + "keybind", keybind, error);
                }
            }
            for (Setting setting : module.settings) {
                String key = prefix + "setting." + setting.name;
                String value = properties.getProperty(key);
                if (value != null) {
                    applySetting(setting, key, value);
                }
            }
        }
        for (Module module : modules) {
            String enabledValue = properties.getProperty("module." + module.name + ".enabled");
            if (enabledValue != null) {
                try {
                    if (parseBoolean(enabledValue)) {
                        module.enable();
                    }
                } catch (IllegalArgumentException error) {
                    reportInvalidSetting("module." + module.name + ".enabled", enabledValue, error);
                }
            }
        }
        configurationLoaded = true;
    }

    private String settingValue(Setting setting) {
        return switch (setting.type) {
            case BOOL -> Boolean.toString(setting.getBool());
            case INT -> Integer.toString(setting.getInt());
            case DOUBLE -> Double.toString(setting.getDouble());
            case ENUM -> setting.getEnum();
            case COLOR -> Integer.toString(setting.getColor());
            case KEY -> Integer.toString(setting.getKey());
        };
    }

    private void applySetting(Setting setting, String key, String value) {
        try {
            switch (setting.type) {
                case BOOL -> setting.setBool(parseBoolean(value));
                case INT -> setting.setInt(Integer.parseInt(value));
                case DOUBLE -> setting.setDouble(Double.parseDouble(value));
                case ENUM -> setting.setEnum(value);
                case COLOR -> setting.setColor(Integer.parseInt(value));
                case KEY -> setting.setKey(Integer.parseInt(value));
            }
        } catch (IllegalArgumentException error) {
            reportInvalidSetting(key, value, error);
        }
    }

    private void reportInvalidSetting(String key, String value, IllegalArgumentException error) {
        System.err.println("[Bald Agent] Ignoring invalid config value for " + key + ": " + value);
        if (debug) {
            error.printStackTrace(System.err);
        }
    }

    private boolean parseBoolean(String value) {
        if (value.equalsIgnoreCase("true")) {
            return true;
        }
        if (value.equalsIgnoreCase("false")) {
            return false;
        }
        throw new IllegalArgumentException("Expected true or false, got " + value);
    }

    public static void toggleModule(int index) {
        try {
            if (instance != null && index >= 0 && index < instance.modules.size()) {
                instance.modules.get(index).toggle();
                saveConfiguration();
            }
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void closeMenu() {
        if (instance != null) {
            instance.gui.close();
        }
    }

    public static void blockQuery(Object level, Object pos) {
        try {
            instance.bus.post(new BlockQueryEvent(level, pos));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void eyeHeight(Object entity) {
        try {
            instance.bus.post(new EyeHeightEvent(entity));
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static void overlayMessage(Object gui, Object text, boolean animate) {
        try {
            instance.gui.overlayMessage();
        } catch (Throwable t) {
            fault(t);
        }
    }

    public static List<Module> byCategory(Category category) {
        List<Module> out = new ArrayList<>();
        for (Module module : instance.modules) {
            if (module.category == category) {
                out.add(module);
            }
        }
        return out;
    }
}
