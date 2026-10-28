package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.option.ControlsOptionsScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.option.VideoOptionsScreen;
import net.minecraft.text.Text;

public class BaldPerformanceScreen extends BaldLauncherScreen {
    private static final int PANEL_MAX_WIDTH = 704;
    private static final int PANEL_MAX_HEIGHT = 456;
    private final Screen parent;
    private Page page = Page.OVERVIEW;
    private String feedback = "";

    public BaldPerformanceScreen(Screen parent) {
        super(Text.literal("Bald Client"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        labels.clear();
        metrics.clear();
        int panelWidth = panelWidth();
        int panelHeight = panelHeight();
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(0, (height - panelHeight) / 2);
        boolean compact = compactLayout();
        int navX = panelX + 16;
        int navY = panelY + (compact ? 58 : 70);
        int contentX;
        int contentWidth;
        int contentY;
        if (compact) {
            int tabGap = 5;
            int tabWidth = (panelWidth - 32 - tabGap * 2) / 3;
            addButton("OVERVIEW", navX, navY, tabWidth, 24, page == Page.OVERVIEW,
                    false, () -> selectPage(Page.OVERVIEW));
            addButton("HUD MODULES", navX + tabWidth + tabGap, navY, tabWidth, 24,
                    page == Page.HUD, false, () -> selectPage(Page.HUD));
            addButton("INTERFACE", navX + (tabWidth + tabGap) * 2, navY,
                    tabWidth, 24, page == Page.INTERFACE, false, () -> selectPage(Page.INTERFACE));
            contentX = navX;
            contentWidth = panelWidth - 32;
            contentY = navY + 34;
        } else {
            int navWidth = Math.min(150, panelWidth / 4);
            contentX = navX + navWidth + 14;
            contentWidth = panelX + panelWidth - 16 - contentX;
            contentY = panelY + 70;
            addButton("OVERVIEW", navX, navY, navWidth, 32, page == Page.OVERVIEW,
                    false, () -> selectPage(Page.OVERVIEW));
            addButton("HUD MODULES", navX, navY + 38, navWidth, 32, page == Page.HUD,
                    false, () -> selectPage(Page.HUD));
            addButton("INTERFACE", navX, navY + 76, navWidth, 32, page == Page.INTERFACE,
                    false, () -> selectPage(Page.INTERFACE));
        }

        switch (page) {
            case OVERVIEW -> initOverview(contentX, contentY, contentWidth);
            case HUD -> initHud(contentX, contentY, contentWidth);
            case INTERFACE -> initInterface(contentX, contentY, contentWidth);
        }

        int footerY = panelY + panelHeight - (compact ? 36 : 42);
        int footerGap = 6;
        int footerWidth = (panelWidth - 32 - footerGap * 2) / 3;
        int footerHeight = compact ? 24 : 28;
        addButton("HUD EDITOR", panelX + 16, footerY, footerWidth, footerHeight, false, true,
                () -> client.setScreen(new BaldHudEditorScreen(this)));
        addButton("VIDEO SETTINGS", panelX + 16 + footerWidth + footerGap, footerY,
                footerWidth, footerHeight, false, false,
                () -> client.setScreen(new VideoOptionsScreen(this, client, client.options)));
        addButton("BACK", panelX + 16 + (footerWidth + footerGap) * 2, footerY,
                footerWidth, footerHeight, false, false, () -> client.setScreen(parent));
    }

    private void initOverview(int x, int y, int contentWidth) {
        boolean compact = compactLayout();
        int gap = 6;
        int cardWidth = (contentWidth - gap * 2) / 3;
        addMetric("FPS", Integer.toString(client.getCurrentFps()), x, y, cardWidth);
        addMetric("PING", getPingText(), x + cardWidth + gap, y, cardWidth);
        addMetric("CPS", Integer.toString(BaldLauncherClient.getClicksPerSecond()),
                x + (cardWidth + gap) * 2, y, cardWidth);

        int sectionOffset = compact ? 62 : 88;
        int controlOffset = compact ? 82 : 110;
        addSectionLabel("QUICK CONTROLS", x, y + sectionOffset, contentWidth);
        int buttonGap = 7;
        int buttonWidth = (contentWidth - buttonGap) / 2;
        addToggle("Performance HUD", BaldLauncherClient.isPerformanceHudEnabled(),
                x, y + controlOffset, buttonWidth,
                preferences -> preferences.withPerformanceHudEnabled(!preferences.performanceHudEnabled()));
        addToggle("Performance button", BaldLauncherClient.isPerformanceButtonEnabled(),
                x + buttonWidth + buttonGap, y + controlOffset, buttonWidth,
                preferences -> preferences.withPerformanceButtonEnabled(
                        !preferences.performanceButtonEnabled()));
        addButton("OPEN HUD MODULES", x, y + (compact ? 114 : 150), contentWidth,
                compact ? 24 : 30, true, false,
                () -> selectPage(Page.HUD));
    }

    private void initHud(int x, int y, int contentWidth) {
        boolean compact = compactLayout();
        int controlHeight = controlHeight();
        int masterStep = compact ? 31 : 38;
        int rowStep = compact ? 28 : 34;
        addSectionLabel("ON-SCREEN MODULES", x, y, contentWidth);
        int gap = 6;
        int buttonWidth = (contentWidth - gap) / 2;
        int rowY = y + (compact ? 20 : 24);
        addToggle("Performance HUD", BaldLauncherClient.isPerformanceHudEnabled(),
                x, rowY, contentWidth,
                preferences -> preferences.withPerformanceHudEnabled(!preferences.performanceHudEnabled()));
        rowY += masterStep;

        addToggle("FPS", BaldLauncherClient.isFpsHudEnabled(), x, rowY, buttonWidth,
                preferences -> preferences.withFpsHudEnabled(!preferences.fpsHudEnabled()));
        addToggle("Frame time", BaldLauncherClient.isFrameTimeHudEnabled(),
                x + buttonWidth + gap, rowY, buttonWidth,
                preferences -> preferences.withFrameTimeHudEnabled(!preferences.frameTimeHudEnabled()));
        rowY += rowStep;
        addToggle("Ping", BaldLauncherClient.isPingHudEnabled(), x, rowY, buttonWidth,
                preferences -> preferences.withPingHudEnabled(!preferences.pingHudEnabled()));
        addToggle("Memory", BaldLauncherClient.isMemoryHudEnabled(),
                x + buttonWidth + gap, rowY, buttonWidth,
                preferences -> preferences.withMemoryHudEnabled(!preferences.memoryHudEnabled()));
        rowY += rowStep;
        addToggle("Coordinates", BaldLauncherClient.isCoordinatesHudEnabled(), x, rowY, buttonWidth,
                preferences -> preferences.withCoordinatesHudEnabled(!preferences.coordinatesHudEnabled()));
        addToggle("CPS", BaldLauncherClient.isCpsHudEnabled(),
                x + buttonWidth + gap, rowY, buttonWidth,
                preferences -> preferences.withCpsHudEnabled(!preferences.cpsHudEnabled()));
        rowY += rowStep;
        addToggle("Keystrokes", BaldLauncherClient.isKeystrokesHudEnabled(), x, rowY, buttonWidth,
                preferences -> preferences.withKeystrokesHudEnabled(!preferences.keystrokesHudEnabled()));

        rowY += compact ? 30 : 42;
        int styleWidth = (contentWidth - gap) / 2;
        addButton("STYLE  ·  " + (BaldLauncherClient.isHudCardStyleEnabled() ? "CARDS" : "COMPACT"),
                x, rowY, styleWidth, controlHeight, true, false, this::toggleHudStyle);
        addButton("ACCENT  ·  " + BaldLauncherClient.getHudAccentName(),
                x + styleWidth + gap, rowY, styleWidth, controlHeight, false, false, this::cycleHudAccent);
    }

    private void initInterface(int x, int y, int contentWidth) {
        boolean compact = compactLayout();
        addSectionLabel("BALD CLIENT INTERFACE", x, y, contentWidth);
        int buttonGap = 7;
        int buttonWidth = (contentWidth - buttonGap) / 2;
        int rowY = y + (compact ? 18 : 26);
        addToggle("Custom menus", BaldLauncherClient.isEnabled(), x, rowY, buttonWidth,
                preferences -> preferences.withMenuEnabled(!preferences.menuEnabled()));
        addToggle("Performance button", BaldLauncherClient.isPerformanceButtonEnabled(),
                x + buttonWidth + buttonGap, rowY, buttonWidth,
                preferences -> preferences.withPerformanceButtonEnabled(
                        !preferences.performanceButtonEnabled()));
        rowY += compact ? 30 : 38;
        addToggle("In-game shortcut", BaldLauncherClient.isInGameButtonEnabled(),
                x, rowY, buttonWidth,
                preferences -> preferences.withInGameButtonEnabled(!preferences.inGameButtonEnabled()));
        addButton("KEYBINDS", x + buttonWidth + buttonGap, rowY, buttonWidth, 30,
                false, false, () -> client.setScreen(new ControlsOptionsScreen(this, client.options)));
    }

    private void addSectionLabel(String label, int x, int y, int contentWidth) {
        labels.add(new SectionLabel(label, x, y, contentWidth));
    }

    private void addMetric(String label, String value, int x, int y, int cardWidth) {
        metrics.add(new Metric(label, value, x, y, cardWidth));
    }

    private final java.util.List<SectionLabel> labels = new java.util.ArrayList<>();
    private final java.util.List<Metric> metrics = new java.util.ArrayList<>();

    private void addToggle(String label, boolean value, int x, int y, int buttonWidth,
                           java.util.function.UnaryOperator<BaldLauncherClient.VisualPreferences> update) {
        addButton(label + "  ·  " + (value ? "ON" : "OFF"), x, y, buttonWidth, controlHeight(),
                value, false, () -> save(update.apply(BaldLauncherClient.getVisualPreferences())));
    }

    private void addButton(String label, int x, int y, int buttonWidth, int buttonHeight,
                           boolean selected, boolean prominent, Runnable action) {
        addDrawableChild(new BaldClientButtonWidget(x, y, buttonWidth, buttonHeight,
                BaldText.button(label, prominent), selected, prominent, action));
    }

    private void selectPage(Page nextPage) {
        page = nextPage;
        clearAndInit();
    }

    private void save(BaldLauncherClient.VisualPreferences preferences) {
        boolean menuChanged = preferences.menuEnabled()
                != BaldLauncherClient.getVisualPreferences().menuEnabled();
        boolean performanceButtonChanged = preferences.performanceButtonEnabled()
                != BaldLauncherClient.getVisualPreferences().performanceButtonEnabled();
        try {
            BaldLauncherClient.saveVisualPreferences(preferences);
            feedback = "Settings saved";
            if (menuChanged || performanceButtonChanged) {
                BaldLauncherClient.refreshMenuAfterToggle();
                return;
            }
            clearAndInit();
        } catch (Exception error) {
            showSaveError(error);
        }
    }

    private void toggleHudStyle() {
        try {
            BaldLauncherClient.saveHudAppearance(
                    !BaldLauncherClient.isHudCardStyleEnabled(), BaldLauncherClient.getHudAccentIndex());
            feedback = "HUD style saved";
            clearAndInit();
        } catch (Exception error) {
            showSaveError(error);
        }
    }

    private void cycleHudAccent() {
        try {
            BaldLauncherClient.saveHudAppearance(BaldLauncherClient.isHudCardStyleEnabled(),
                    (BaldLauncherClient.getHudAccentIndex() + 1) % BaldLauncherClient.getHudAccentCount());
            feedback = "HUD accent saved";
            clearAndInit();
        } catch (Exception error) {
            showSaveError(error);
        }
    }

    private void showSaveError(Exception error) {
        feedback = "Could not save settings: " + error.getMessage();
        System.err.println("[Bald Launcher] Could not save in-game preferences: " + error.getMessage());
    }

    private String getPingText() {
        if (client.player == null || client.getNetworkHandler() == null) return "--";
        var entry = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
        return entry == null || entry.getLatency() < 0 ? "--" : entry.getLatency() + " ms";
    }

    private int panelWidth() {
        return Math.min(PANEL_MAX_WIDTH, Math.max(0, width - 16));
    }

    private int panelHeight() {
        return Math.min(PANEL_MAX_HEIGHT, Math.max(0, height - 16));
    }

    private boolean compactLayout() {
        return width < PANEL_MAX_WIDTH + 16 || height < 520;
    }

    private int controlHeight() {
        return compactLayout() ? 24 : 30;
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        if (client.world != null) context.fill(0, 0, width, height, 0x30070B0D);

        int panelWidth = panelWidth();
        int panelHeight = panelHeight();
        int x = (width - panelWidth) / 2;
        int y = Math.max(10, (height - panelHeight) / 2);
        BaldUi.rounded(context, x - 1, y + 3, x + panelWidth + 1, y + panelHeight + 4, 14, 0x66000000);
        BaldUi.rounded(context, x, y, x + panelWidth, y + panelHeight, 12, 0xF011171B);
        BaldUi.outline(context, x, y, x + panelWidth, y + panelHeight, 12, 0xFF34474A);
        BaldUi.rounded(context, x + 1, y + 1, x + panelWidth - 1, y + 4, 11, 0x18FFFFFF);
        context.fill(x + 14, y + 54, x + panelWidth - 14, y + 55, 0xFF2A3438);

        context.drawTextWithShadow(textRenderer, BaldText.title("BALD CLIENT"),
                x + 18, y + 16, BaldUi.TEXT);
        context.drawTextWithShadow(textRenderer, BaldText.label("Performance, modules and HUD layout"),
                x + 19, y + 36, BaldUi.MUTED);
        if (panelWidth >= 600) {
            context.drawTextWithShadow(textRenderer, BaldText.label("RIGHT SHIFT  MODULES     H  EDIT HUD"),
                    x + panelWidth - 220, y + 24, BaldUi.MUTED);
        }
        renderPageContent(context, x, y, panelWidth);
        if (!feedback.isEmpty()) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label(feedback),
                    width / 2, y + panelHeight - 60, BaldUi.ACCENT);
        }
        super.render(context, mouseX, mouseY, delta);
    }

    private void renderPageContent(DrawContext context, int panelX, int panelY, int panelWidth) {
        int navWidth = Math.min(150, panelWidth / 4);
        int contentX = panelX + 16 + navWidth + 14;
        int contentY = panelY + 70;
        context.fill(contentX - 8, contentY, contentX - 7, panelY + panelHeight() - 52, 0xFF2A3438);

        for (SectionLabel label : labels) {
            context.drawTextWithShadow(textRenderer, BaldText.label(label.text()),
                    label.x(), label.y(), BaldUi.ACCENT);
            context.fill(label.x(), label.y() + 11, label.x() + label.width(), label.y() + 12, 0xFF303E42);
        }
        for (Metric metric : metrics) {
            int cardHeight = compactLayout() ? 48 : 64;
            BaldUi.rounded(context, metric.x(), metric.y(), metric.x() + metric.width(),
                    metric.y() + cardHeight, 8, 0xFF171F23);
            BaldUi.outline(context, metric.x(), metric.y(), metric.x() + metric.width(),
                    metric.y() + cardHeight, 8, 0xFF303E42);
            BaldUi.rounded(context, metric.x() + 8, metric.y() + 1,
                    metric.x() + metric.width() - 8, metric.y() + 2, 1,
                    BaldLauncherClient.getHudAccentColor());
            context.drawTextWithShadow(textRenderer, BaldText.label(metric.label()),
                    metric.x() + 8, metric.y() + 6, BaldUi.MUTED);
            String value = liveMetric(metric.label(), metric.value());
            context.drawTextWithShadow(textRenderer, BaldText.title(value),
                    metric.x() + 8, metric.y() + (compactLayout() ? 24 : 31),
                    BaldLauncherClient.getHudAccentColor());
        }
    }

    private String liveMetric(String label, String initialValue) {
        return switch (label) {
            case "FPS" -> Integer.toString(client.getCurrentFps());
            case "PING" -> getPingText();
            case "CPS" -> Integer.toString(BaldLauncherClient.getClicksPerSecond());
            default -> initialValue;
        };
    }

    @Override
    public boolean shouldPause() {
        return false;
    }

    private enum Page {
        OVERVIEW,
        HUD,
        INTERFACE
    }

    private record SectionLabel(String text, int x, int y, int width) {}
    private record Metric(String label, String value, int x, int y, int width) {}
}
