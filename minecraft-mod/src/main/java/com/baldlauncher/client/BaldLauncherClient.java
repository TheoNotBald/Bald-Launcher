package com.baldlauncher.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import org.lwjgl.glfw.GLFW;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class BaldLauncherClient implements ClientModInitializer {
    public record Account(String id, String name) {}
    public record VisualPreferences(boolean menuEnabled, boolean performanceButtonEnabled,
                                    boolean inGameButtonEnabled, boolean performanceHudEnabled,
                                    boolean fpsHudEnabled, boolean frameTimeHudEnabled,
                                    boolean pingHudEnabled, boolean memoryHudEnabled,
                                    boolean coordinatesHudEnabled, boolean cpsHudEnabled,
                                    boolean keystrokesHudEnabled) {
        public VisualPreferences withMenuEnabled(boolean value) {
            return new VisualPreferences(value, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withPerformanceButtonEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, value, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withInGameButtonEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, value,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withPerformanceHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    value, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withFpsHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, value, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withFrameTimeHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, value, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withPingHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, value, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withMemoryHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, value,
                    coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withCoordinatesHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    value, cpsHudEnabled, keystrokesHudEnabled);
        }

        public VisualPreferences withCpsHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, value, keystrokesHudEnabled);
        }

        public VisualPreferences withKeystrokesHudEnabled(boolean value) {
            return new VisualPreferences(menuEnabled, performanceButtonEnabled, inGameButtonEnabled,
                    performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                    coordinatesHudEnabled, cpsHudEnabled, value);
        }
    }

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
    private static boolean clientModEnabled = true;
    private static boolean enabled;
    private static boolean performanceButtonEnabled;
    private static boolean inGameButtonEnabled = true;
    private static boolean performanceHudEnabled;
    private static boolean fpsHudEnabled = true;
    private static boolean frameTimeHudEnabled = true;
    private static boolean pingHudEnabled = true;
    private static boolean memoryHudEnabled = true;
    private static boolean coordinatesHudEnabled;
    private static boolean cpsHudEnabled;
    private static boolean keystrokesHudEnabled;
    private static boolean launcherMenuSetting;
    private static boolean launcherPerformanceButtonSetting;
    private static boolean launcherButtonSetting = true;
    private static boolean launcherHudSetting;
    private static boolean launcherConfigurationLoaded;
    private static boolean initialized;
    private static boolean hudCardStyleEnabled = true;
    private static int hudAccentIndex;
    private static final int[] HUD_ACCENT_COLORS = {
            0xFF8FC8C7, 0xFF91BCE8, 0xFFB6A0E5, 0xFFE4B879, 0xFFE58F9B
    };
    private static final String[] HUD_ACCENT_NAMES = {"TEAL", "BLUE", "VIOLET", "AMBER", "ROSE"};
    private static String profileId = "";
    private static String activeAccountId = "";
    private static String bridgeToken = "";
    private static URI bridgeUri;
    private static List<Account> accounts = List.of();
    private static KeyBinding openSettingsKey;
    private static KeyBinding openModuleMenuKey;
    private static KeyBinding openHudEditorKey;
    private static final long[] CLICK_TIMESTAMPS = new long[64];
    private static int clickTimestampIndex;

    @Override
    public synchronized void onInitializeClient() {
        if (initialized) return;
        initialized = true;
        loadConfiguration();
        loadProfilePreferences();
        if (!clientModEnabled) return;
        KeyBinding.Category category = KeyBinding.Category.create(
                Identifier.of("baldlauncher", "client_controls"));
        openSettingsKey = KeyBindingHelper.registerKeyBinding(
                new KeyBinding(
                        "key.baldlauncher.open_settings",
                        InputUtil.Type.KEYSYM,
                        GLFW.GLFW_KEY_RIGHT_ALT,
                        category
                )
        );
        openModuleMenuKey = KeyBindingHelper.registerKeyBinding(
                new KeyBinding(
                        "key.baldlauncher.open_mod_menu",
                        InputUtil.Type.KEYSYM,
                        GLFW.GLFW_KEY_RIGHT_SHIFT,
                        category
                )
        );
        openHudEditorKey = KeyBindingHelper.registerKeyBinding(
                new KeyBinding(
                        "key.baldlauncher.open_hud_editor",
                        InputUtil.Type.KEYSYM,
                        GLFW.GLFW_KEY_H,
                        category
                )
        );
        HudElementRegistry.addLast(Identifier.of("baldlauncher", "in_game_hud"),
                (drawContext, tickCounter) -> BaldHudRenderer.render(drawContext));
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (openModuleMenuKey.wasPressed()) {
                if ((client.player != null && (client.currentScreen == null
                        || client.currentScreen instanceof GameMenuScreen
                        || client.currentScreen instanceof BaldPauseScreen
                        || client.currentScreen instanceof BaldMainMenuScreen))
                        || client.currentScreen instanceof TitleScreen) {
                    client.setScreen(new BaldModuleMenuScreen(client.currentScreen));
                }
            }
            while (openHudEditorKey.wasPressed()) {
                if (client.player != null && client.world != null
                        && (client.currentScreen == null || client.currentScreen instanceof GameMenuScreen
                        || client.currentScreen instanceof BaldPauseScreen)) {
                    client.setScreen(new BaldHudEditorScreen(client.currentScreen));
                }
            }
            while (openSettingsKey.wasPressed()) {
                if ((client.player != null && (client.currentScreen == null
                        || client.currentScreen instanceof GameMenuScreen
                        || client.currentScreen instanceof BaldPauseScreen
                        || client.currentScreen instanceof BaldMainMenuScreen))
                        || client.currentScreen instanceof TitleScreen) {
                    client.setScreen(new BaldPerformanceScreen(client.currentScreen));
                }
            }
        });
    }

    private static void loadConfiguration() {
        String configFile = System.getProperty("baldlauncher.config", "").trim();
        if (configFile.isEmpty()) return;
        try {
            JsonObject config = JsonParser.parseString(Files.readString(Path.of(configFile))).getAsJsonObject();
            clientModEnabled = readConfigBoolean(config, "clientModEnabled", true);
            enabled = readConfigBoolean(config, "enabled", false);
            performanceButtonEnabled = readConfigBoolean(config, "performanceButtonEnabled", false);
            inGameButtonEnabled = readConfigBoolean(config, "inGameButtonEnabled", true);
            performanceHudEnabled = readConfigBoolean(config, "performanceHudEnabled", false);
            launcherMenuSetting = enabled;
            launcherPerformanceButtonSetting = performanceButtonEnabled;
            launcherButtonSetting = inGameButtonEnabled;
            launcherHudSetting = performanceHudEnabled;
            profileId = config.get("profileId").getAsString();
            activeAccountId = config.get("activeAccountId").getAsString();
            bridgeToken = config.get("bridgeToken").getAsString();
            bridgeUri = URI.create(config.get("bridgeUrl").getAsString());
            JsonArray accountArray = config.getAsJsonArray("accounts");
            List<Account> loadedAccounts = new ArrayList<>();
            accountArray.forEach(value -> {
                JsonObject account = value.getAsJsonObject();
                loadedAccounts.add(new Account(account.get("id").getAsString(), account.get("name").getAsString()));
            });
            accounts = List.copyOf(loadedAccounts);
            launcherConfigurationLoaded = true;
        } catch (Exception error) {
            clientModEnabled = false;
            enabled = false;
            performanceButtonEnabled = false;
            inGameButtonEnabled = false;
            performanceHudEnabled = false;
            System.err.println("[Bald Launcher] Could not read menu integration settings: " + error.getMessage());
        }
    }

    private static boolean readConfigBoolean(JsonObject config, String key, boolean fallback) {
        if (!config.has(key) || config.get(key).isJsonNull()) return fallback;
        if (!config.get(key).isJsonPrimitive() || !config.getAsJsonPrimitive(key).isBoolean()) {
            System.err.println("[Bald Launcher] Invalid boolean in launcher config for "
                    + key + "; using the safe default.");
            return fallback;
        }
        return config.get(key).getAsBoolean();
    }

    private static Path getPreferencesPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("baldlauncher-client.json");
    }

    private static void loadProfilePreferences() {
        Path preferencesPath = getPreferencesPath();
        if (!Files.exists(preferencesPath)) return;
        try {
            JsonObject preferences = JsonParser.parseString(Files.readString(preferencesPath)).getAsJsonObject();
            boolean previousLauncherButton = preferenceBoolean(preferences, "launcherButtonSetting", false);
            boolean previousLauncherHud = preferenceBoolean(preferences, "launcherHudSetting", false);
            boolean previousLauncherMenu = preferenceBoolean(preferences, "launcherMenuSetting", false);
            boolean previousLauncherPerformanceButton =
                    preferenceBoolean(preferences, "launcherPerformanceButtonSetting", false);
            if (hasBooleanPreference(preferences, "menuEnabled")
                    && (!launcherConfigurationLoaded || hasBooleanPreference(preferences, "launcherMenuSetting")
                    && previousLauncherMenu == launcherMenuSetting)) {
                enabled = preferences.get("menuEnabled").getAsBoolean();
            }
            if (hasBooleanPreference(preferences, "performanceButtonEnabled")
                    && (!launcherConfigurationLoaded
                    || hasBooleanPreference(preferences, "launcherPerformanceButtonSetting")
                    && previousLauncherPerformanceButton == launcherPerformanceButtonSetting)) {
                performanceButtonEnabled = preferences.get("performanceButtonEnabled").getAsBoolean();
            }
            if (hasBooleanPreference(preferences, "inGameButtonEnabled")
                    && (!launcherConfigurationLoaded || hasBooleanPreference(preferences, "launcherButtonSetting")
                    && previousLauncherButton == launcherButtonSetting)) {
                inGameButtonEnabled = preferences.get("inGameButtonEnabled").getAsBoolean();
            }
            if (hasBooleanPreference(preferences, "performanceHudEnabled")
                    && (!launcherConfigurationLoaded || hasBooleanPreference(preferences, "launcherHudSetting")
                    && previousLauncherHud == launcherHudSetting)) {
                performanceHudEnabled = preferences.get("performanceHudEnabled").getAsBoolean();
            }
            fpsHudEnabled = preferenceBoolean(preferences, "fpsHudEnabled", fpsHudEnabled);
            frameTimeHudEnabled = preferenceBoolean(preferences, "frameTimeHudEnabled", frameTimeHudEnabled);
            pingHudEnabled = preferenceBoolean(preferences, "pingHudEnabled", pingHudEnabled);
            memoryHudEnabled = preferenceBoolean(preferences, "memoryHudEnabled", memoryHudEnabled);
            coordinatesHudEnabled = preferenceBoolean(preferences, "coordinatesHudEnabled", coordinatesHudEnabled);
            cpsHudEnabled = preferenceBoolean(preferences, "cpsHudEnabled", cpsHudEnabled);
            keystrokesHudEnabled = preferenceBoolean(preferences, "keystrokesHudEnabled", keystrokesHudEnabled);
            hudCardStyleEnabled = preferenceBoolean(preferences, "hudCardStyleEnabled", hudCardStyleEnabled);
            if (preferences.has("hudAccentIndex")) {
                hudAccentIndex = Math.floorMod(preferences.get("hudAccentIndex").getAsInt(),
                        HUD_ACCENT_COLORS.length);
            }
        } catch (Exception error) {
            System.err.println("[Bald Launcher] Could not read in-game preferences from "
                    + preferencesPath + ": " + error.getMessage());
        }
    }

    private static boolean preferenceBoolean(JsonObject preferences, String key, boolean fallback) {
        if (!preferences.has(key) || preferences.get(key).isJsonNull()) return fallback;
        if (!preferences.get(key).isJsonPrimitive()
                || !preferences.getAsJsonPrimitive(key).isBoolean()) {
            System.err.println("[Bald Launcher] Invalid in-game preference for " + key
                    + "; using the safe default.");
            return fallback;
        }
        return preferences.get(key).getAsBoolean();
    }

    private static boolean hasBooleanPreference(JsonObject preferences, String key) {
        return preferences.has(key) && preferences.get(key).isJsonPrimitive()
                && preferences.getAsJsonPrimitive(key).isBoolean();
    }

    public static void saveVisualPreferences(VisualPreferences value) throws Exception {
        Path preferencesPath = getPreferencesPath();
        Files.createDirectories(preferencesPath.getParent());
        JsonObject preferences = readPreferencesObject(preferencesPath);
        preferences.addProperty("menuEnabled", value.menuEnabled());
        preferences.addProperty("performanceButtonEnabled", value.performanceButtonEnabled());
        preferences.addProperty("inGameButtonEnabled", value.inGameButtonEnabled());
        preferences.addProperty("performanceHudEnabled", value.performanceHudEnabled());
        preferences.addProperty("fpsHudEnabled", value.fpsHudEnabled());
        preferences.addProperty("frameTimeHudEnabled", value.frameTimeHudEnabled());
        preferences.addProperty("pingHudEnabled", value.pingHudEnabled());
        preferences.addProperty("memoryHudEnabled", value.memoryHudEnabled());
        preferences.addProperty("coordinatesHudEnabled", value.coordinatesHudEnabled());
        preferences.addProperty("cpsHudEnabled", value.cpsHudEnabled());
        preferences.addProperty("keystrokesHudEnabled", value.keystrokesHudEnabled());
        preferences.addProperty("hudCardStyleEnabled", hudCardStyleEnabled);
        preferences.addProperty("hudAccentIndex", hudAccentIndex);
        preferences.addProperty("launcherMenuSetting", launcherMenuSetting);
        preferences.addProperty("launcherPerformanceButtonSetting", launcherPerformanceButtonSetting);
        preferences.addProperty("launcherButtonSetting", launcherButtonSetting);
        preferences.addProperty("launcherHudSetting", launcherHudSetting);
        writePreferencesObject(preferencesPath, preferences);
        enabled = value.menuEnabled();
        performanceButtonEnabled = value.performanceButtonEnabled();
        inGameButtonEnabled = value.inGameButtonEnabled();
        performanceHudEnabled = value.performanceHudEnabled();
        fpsHudEnabled = value.fpsHudEnabled();
        frameTimeHudEnabled = value.frameTimeHudEnabled();
        pingHudEnabled = value.pingHudEnabled();
        memoryHudEnabled = value.memoryHudEnabled();
        coordinatesHudEnabled = value.coordinatesHudEnabled();
        cpsHudEnabled = value.cpsHudEnabled();
        keystrokesHudEnabled = value.keystrokesHudEnabled();
        if (!performanceHudEnabled || !cpsHudEnabled) {
            Arrays.fill(CLICK_TIMESTAMPS, 0L);
            clickTimestampIndex = 0;
        }
    }

    public static synchronized void saveHudAppearance(boolean cardStyleEnabled, int accentIndex) throws Exception {
        Path preferencesPath = getPreferencesPath();
        Files.createDirectories(preferencesPath.getParent());
        JsonObject preferences = readPreferencesObject(preferencesPath);
        int normalizedAccent = Math.floorMod(accentIndex, HUD_ACCENT_COLORS.length);
        preferences.addProperty("hudCardStyleEnabled", cardStyleEnabled);
        preferences.addProperty("hudAccentIndex", normalizedAccent);
        writePreferencesObject(preferencesPath, preferences);
        hudCardStyleEnabled = cardStyleEnabled;
        hudAccentIndex = normalizedAccent;
    }

    private static JsonObject readPreferencesObject(Path path) throws Exception {
        if (!Files.exists(path)) return new JsonObject();
        return JsonParser.parseString(Files.readString(path)).getAsJsonObject();
    }

    private static void writePreferencesObject(Path path, JsonObject preferences) throws Exception {
        Path temporaryPath = Files.createTempFile(path.getParent(), "baldlauncher-", ".tmp");
        try {
            Files.writeString(temporaryPath, preferences.toString());
            try {
                Files.move(temporaryPath, path, StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException error) {
                Files.move(temporaryPath, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporaryPath);
        }
    }

    public static synchronized void saveHudWidget(String id, float x, float y, float scale) throws Exception {
        Path path = getPreferencesPath();
        Files.createDirectories(path.getParent());
        JsonObject preferences = readPreferencesObject(path);
        JsonObject layout = preferences.has("hudLayout") && preferences.get("hudLayout").isJsonObject()
                ? preferences.getAsJsonObject("hudLayout") : new JsonObject();
        JsonObject widget = new JsonObject();
        widget.addProperty("x", Math.max(0.0f, Math.min(1.0f, x)));
        widget.addProperty("y", Math.max(0.0f, Math.min(1.0f, y)));
        widget.addProperty("scale", Math.max(0.75f, Math.min(2.0f, scale)));
        layout.add(id, widget);
        preferences.add("hudLayout", layout);
        writePreferencesObject(path, preferences);
    }

    public static float[] loadHudWidget(String id) {
        Path path = getPreferencesPath();
        if (!Files.exists(path)) return null;
        try {
            JsonObject preferences = JsonParser.parseString(Files.readString(path)).getAsJsonObject();
            if (!preferences.has("hudLayout") || !preferences.get("hudLayout").isJsonObject()) return null;
            JsonObject layout = preferences.getAsJsonObject("hudLayout");
            if (!layout.has(id) || !layout.get(id).isJsonObject()) return null;
            JsonObject widget = layout.getAsJsonObject(id);
            float x = Math.max(0.0f, Math.min(1.0f, widget.get("x").getAsFloat()));
            float y = Math.max(0.0f, Math.min(1.0f, widget.get("y").getAsFloat()));
            float scale = widget.has("scale")
                    ? Math.max(0.75f, Math.min(2.0f, widget.get("scale").getAsFloat())) : 1.0f;
            return new float[]{x, y, scale};
        } catch (Exception error) {
            System.err.println("[Bald Launcher] Could not read HUD layout from "
                    + path + ": " + error.getMessage());
            return null;
        }
    }

    public static void registerMouseClick(int button) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (isPerformanceHudEnabled() && isCpsHudEnabled()
                && client.player != null && client.currentScreen == null
                && (button == GLFW.GLFW_MOUSE_BUTTON_LEFT || button == GLFW.GLFW_MOUSE_BUTTON_RIGHT)) {
            CLICK_TIMESTAMPS[clickTimestampIndex] = System.nanoTime();
            clickTimestampIndex = (clickTimestampIndex + 1) % CLICK_TIMESTAMPS.length;
        }
    }

    public static int getClicksPerSecond() {
        long cutoff = System.nanoTime() - 1_000_000_000L;
        int count = 0;
        for (long timestamp : CLICK_TIMESTAMPS) {
            if (timestamp > cutoff) count++;
        }
        return count;
    }

    public static boolean isHudCardStyleEnabled() { return hudCardStyleEnabled; }

    public static int getHudAccentIndex() { return hudAccentIndex; }

    public static int getHudAccentCount() { return HUD_ACCENT_COLORS.length; }

    public static int getHudAccentColor() { return HUD_ACCENT_COLORS[hudAccentIndex]; }

    public static String getHudAccentName() { return HUD_ACCENT_NAMES[hudAccentIndex]; }

    public static String getModuleMenuKeyName() {
        return openModuleMenuKey.getBoundKeyLocalizedText().getString();
    }

    public static String getHudEditorKeyName() {
        return openHudEditorKey.getBoundKeyLocalizedText().getString();
    }

    public static VisualPreferences getVisualPreferences() {
        return new VisualPreferences(enabled, performanceButtonEnabled, inGameButtonEnabled,
                performanceHudEnabled, fpsHudEnabled, frameTimeHudEnabled, pingHudEnabled, memoryHudEnabled,
                coordinatesHudEnabled, cpsHudEnabled, keystrokesHudEnabled);
    }

    public static boolean handleInGameButtonClick(double mouseX, double mouseY) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (!isInGameButtonEnabled() || client.player == null || client.world == null
                || client.currentScreen != null) {
            return false;
        }
        BaldHudRenderer.HudWidget button = BaldHudRenderer.getInGameButtonWidget();
        if (mouseX < button.x() || mouseX > button.x() + button.width()
                || mouseY < button.y() || mouseY > button.y() + button.height()) return false;
        client.setScreen(new BaldPerformanceScreen(null));
        return true;
    }

    public static boolean isEnabled() {
        return clientModEnabled && enabled;
    }

    public static boolean shouldReplaceTitleMenu() {
        return clientModEnabled && enabled;
    }

    public static boolean shouldReplacePauseMenu() {
        return clientModEnabled && enabled;
    }

    public static boolean shouldAddPerformanceButton() {
        return clientModEnabled && !enabled && performanceButtonEnabled;
    }

    public static void refreshMenuAfterToggle() {
        MinecraftClient client = MinecraftClient.getInstance();
        boolean useBaldMenus = clientModEnabled && enabled;
        if (client.player != null && client.world != null) {
            client.setScreen(useBaldMenus
                    ? new BaldPauseScreen()
                    : new GameMenuScreen(true));
        } else {
            client.setScreen(useBaldMenus ? new BaldMainMenuScreen() : new TitleScreen());
        }
    }

    public static void addPerformanceButton(Screen screen) {
        if (!shouldAddPerformanceButton() || screen.width < 100 || screen.height < 32) return;
        List<Element> children = ((com.baldlauncher.client.mixin.ScreenAccessor) screen).bald$getChildren();
        if (children.stream().anyMatch(BaldClientButtonWidget.class::isInstance)) return;

        int buttonWidth = Math.min(142, screen.width - 16);
        int buttonHeight = 24;
        int right = screen.width - buttonWidth - 8;
        int bottom = screen.height - buttonHeight - 8;
        int[][] candidates = {
                {right, 8}, {8, 8}, {right, bottom}, {8, bottom},
                {(screen.width - buttonWidth) / 2, 8}
        };
        String label = screen.width < 220 ? "Bald UI" : "Bald Performance";
        for (int[] candidate : candidates) {
            int x = candidate[0];
            int y = candidate[1];
            boolean occupied = false;
            for (Element child : children) {
                if (child instanceof ClickableWidget widget
                        && x < widget.getX() + widget.getWidth()
                        && x + buttonWidth > widget.getX()
                        && y < widget.getY() + widget.getHeight()
                        && y + buttonHeight > widget.getY()) {
                    occupied = true;
                    break;
                }
            }
            if (occupied) continue;
            ((com.baldlauncher.client.mixin.ScreenAccessor) screen).bald$addDrawableChild(
                    new BaldClientButtonWidget(x, y, buttonWidth, buttonHeight, Text.literal(label),
                            true, true, () -> MinecraftClient.getInstance().setScreen(
                            new BaldPerformanceScreen(screen))));
            return;
        }
    }

    public static boolean isPerformanceButtonEnabled() {
        return clientModEnabled && performanceButtonEnabled;
    }

    public static boolean isInGameButtonEnabled() {
        return clientModEnabled && inGameButtonEnabled;
    }

    public static boolean isPerformanceHudEnabled() {
        return clientModEnabled && performanceHudEnabled;
    }

    public static boolean isFpsHudEnabled() {
        return isPerformanceHudEnabled() && fpsHudEnabled;
    }

    public static boolean isFrameTimeHudEnabled() {
        return isPerformanceHudEnabled() && frameTimeHudEnabled;
    }

    public static boolean isPingHudEnabled() {
        return isPerformanceHudEnabled() && pingHudEnabled;
    }

    public static boolean isMemoryHudEnabled() {
        return isPerformanceHudEnabled() && memoryHudEnabled;
    }

    public static boolean isCoordinatesHudEnabled() { return isPerformanceHudEnabled() && coordinatesHudEnabled; }

    public static boolean isCpsHudEnabled() { return isPerformanceHudEnabled() && cpsHudEnabled; }

    public static boolean isKeystrokesHudEnabled() { return isPerformanceHudEnabled() && keystrokesHudEnabled; }

    public static String getSettingsKeyName() {
        return openSettingsKey.getBoundKeyLocalizedText().getString();
    }

    public static List<Account> getAccounts() {
        return accounts;
    }

    public static String getActiveAccountId() {
        return activeAccountId;
    }

    public static String getProfileId() {
        return profileId;
    }

    public static String getPlayerName() {
        return MinecraftClient.getInstance().getSession().getUsername();
    }

    public static void sendLauncherAction(String action, String accountId) {
        if (bridgeUri == null || bridgeToken.isBlank()) {
            MinecraftClient.getInstance().execute(() -> MinecraftClient.getInstance().setScreen(
                    new BaldMessageScreen(Text.literal("Bald Launcher is not connected"))
            ));
            return;
        }
        JsonObject body = new JsonObject();
        body.addProperty("action", action);
        body.addProperty("profileId", profileId);
        if (accountId != null) body.addProperty("accountId", accountId);
        HttpRequest request = HttpRequest.newBuilder(bridgeUri)
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + bridgeToken)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() != 200) {
                        MinecraftClient.getInstance().execute(() -> MinecraftClient.getInstance().setScreen(
                                new BaldMessageScreen(Text.literal("Launcher action was rejected"))
                        ));
                    }
                })
                .exceptionally(error -> {
                    MinecraftClient.getInstance().execute(() -> MinecraftClient.getInstance().setScreen(
                            new BaldMessageScreen(Text.literal("Open Bald Launcher and try again"))
                    ));
                    return null;
                });
    }
}
