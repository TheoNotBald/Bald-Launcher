package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.option.VideoOptionsScreen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Function;

public final class BaldModuleMenuScreen extends BaldLauncherScreen {
    private final Screen parent;
    private Category category = Category.HUD;
    private TextFieldWidget search;
    private String searchText = "";
    private String feedback = "";

    public BaldModuleMenuScreen(Screen parent) {
        super(Text.literal("Bald Modules"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int panelWidth = Math.min(560, width - 24);
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(8, (height - 390) / 2);
        search = new TextFieldWidget(textRenderer, panelX + 14, panelY + 50,
                panelWidth - 28, 22, Text.literal("Search modules"));
        search.setPlaceholder(Text.literal("Search modules"));
        search.setMaxLength(64);
        search.setText(searchText);
        addDrawableChild(search);

        int tabY = panelY + 80;
        int tabGap = 6;
        int tabWidth = (panelWidth - 28 - tabGap * 2) / 3;
        Category[] categories = Category.values();
        for (int index = 0; index < categories.length; index++) {
            Category value = categories[index];
            addButton(value.label, panelX + 14 + index * (tabWidth + tabGap), tabY, tabWidth, 26,
                    value == category, () -> {
                        searchText = search.getText();
                        category = value;
                        clearAndInit();
                    });
        }

        List<Entry> matches = matchingEntries();
        int columns = 2;
        int gap = 6;
        int cardWidth = (panelWidth - 28 - gap) / columns;
        int firstY = panelY + 116;
        for (int index = 0; index < matches.size() && index < 8; index++) {
            Entry entry = matches.get(index);
            int row = index / columns;
            int column = index % columns;
            int x = panelX + 14 + column * (cardWidth + gap);
            int y = firstY + row * 34;
            if (entry.action() == null) {
                boolean value = entry.enabled().apply(BaldLauncherClient.getVisualPreferences());
                addButton(entry.name() + "  ·  " + (value ? "ON" : "OFF"), x, y, cardWidth, 28,
                        value, () -> toggle(entry));
            } else {
                addButton(entry.name(), x, y, cardWidth, 28, false, entry.action());
            }
        }

        int footerY = panelY + 330;
        int footerGap = 6;
        int footerWidth = (panelWidth - 28 - footerGap * 2) / 3;
        addButton("Edit HUD", panelX + 14, footerY, footerWidth, 28, true,
                () -> client.setScreen(new BaldHudEditorScreen(this)));
        addButton("Performance & UI", panelX + 14 + footerWidth + footerGap, footerY,
                footerWidth, 28, false, () -> client.setScreen(new BaldPerformanceScreen(this)));
        addButton("Done", panelX + 14 + (footerWidth + footerGap) * 2, footerY,
                footerWidth, 28, false, () -> client.setScreen(parent));
    }

    private List<Entry> matchingEntries() {
        String query = search == null ? "" : search.getText().trim().toLowerCase(Locale.ROOT);
        List<Entry> entries = entriesFor(category);
        if (query.isEmpty()) return entries;
        return entries.stream().filter(entry -> entry.name().toLowerCase(Locale.ROOT).contains(query)
                || entry.description().toLowerCase(Locale.ROOT).contains(query)).toList();
    }

    private List<Entry> entriesFor(Category selected) {
        if (selected == Category.HUD) {
            return List.of(
                    toggle("FPS", "Live frames per second", preferences -> preferences.fpsHudEnabled(),
                            preferences -> preferences.withFpsHudEnabled(!preferences.fpsHudEnabled())),
                    toggle("Frame time", "Measured frame interval", preferences -> preferences.frameTimeHudEnabled(),
                            preferences -> preferences.withFrameTimeHudEnabled(!preferences.frameTimeHudEnabled())),
                    toggle("Ping", "Current server latency", preferences -> preferences.pingHudEnabled(),
                            preferences -> preferences.withPingHudEnabled(!preferences.pingHudEnabled())),
                    toggle("Memory", "Used and maximum JVM heap", preferences -> preferences.memoryHudEnabled(),
                            preferences -> preferences.withMemoryHudEnabled(!preferences.memoryHudEnabled())),
                    toggle("Coordinates", "Live player XYZ position", preferences -> preferences.coordinatesHudEnabled(),
                            preferences -> preferences.withCoordinatesHudEnabled(!preferences.coordinatesHudEnabled())),
                    toggle("CPS", "Clicks per second, sampled live", preferences -> preferences.cpsHudEnabled(),
                            preferences -> preferences.withCpsHudEnabled(!preferences.cpsHudEnabled())),
                    toggle("Keystrokes", "Show movement keys while playing", preferences -> preferences.keystrokesHudEnabled(),
                            preferences -> preferences.withKeystrokesHudEnabled(!preferences.keystrokesHudEnabled())),
                    toggle("Performance HUD", "Master switch for all metric widgets",
                            preferences -> preferences.performanceHudEnabled(),
                            preferences -> preferences.withPerformanceHudEnabled(
                                    !preferences.performanceHudEnabled())));
        }
        if (selected == Category.INTERFACE) {
            return List.of(
                    toggle("Custom menus", "Replace the vanilla title and pause menus",
                            preferences -> preferences.menuEnabled(),
                            preferences -> preferences.withMenuEnabled(!preferences.menuEnabled())),
                    toggle("Performance button", "Add a Bald settings shortcut to vanilla menus",
                            preferences -> preferences.performanceButtonEnabled(),
                            preferences -> preferences.withPerformanceButtonEnabled(
                                    !preferences.performanceButtonEnabled())),
                    toggle("In-game button", "Show the compact Bald button in the HUD",
                            preferences -> preferences.inGameButtonEnabled(),
                            preferences -> preferences.withInGameButtonEnabled(
                                    !preferences.inGameButtonEnabled())));
        }
        List<Entry> entries = new ArrayList<>();
        entries.add(new Entry("Video settings", "Minecraft graphics, render distance, and FPS cap",
                null, null, () -> client.setScreen(new VideoOptionsScreen(this, client, client.options))));
        entries.add(new Entry("HUD editor", "Move and resize live Bald HUD widgets",
                null, null, () -> client.setScreen(new BaldHudEditorScreen(this))));
        entries.add(new Entry("Performance & UI", "Bald HUD controls and Minecraft options",
                null, null, () -> client.setScreen(new BaldPerformanceScreen(this))));
        return entries;
    }

    private static Entry toggle(String name, String description,
                                Function<BaldLauncherClient.VisualPreferences, Boolean> enabled,
                                Function<BaldLauncherClient.VisualPreferences,
                                        BaldLauncherClient.VisualPreferences> update) {
        return new Entry(name, description, enabled, update, null);
    }

    private void toggle(Entry entry) {
        try {
            BaldLauncherClient.saveVisualPreferences(entry.update().apply(
                    BaldLauncherClient.getVisualPreferences()));
            feedback = "Saved to this game profile";
            clearAndInit();
        } catch (Exception error) {
            feedback = "Could not save: " + error.getMessage();
            System.err.println("[Bald Launcher] Could not save module settings: " + error.getMessage());
        }
    }

    private void addButton(String label, int x, int y, int width, int height,
                           boolean prominent, Runnable action) {
        addDrawableChild(new BaldClientButtonWidget(x, y, width, height,
                BaldText.button(label, prominent), prominent, prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        int panelWidth = Math.min(560, width - 24);
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(8, (height - 390) / 2);
        BaldUi.drawPanel(context, panelX, panelY, panelWidth, 378);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("BALD MODULES"),
                width / 2, panelY + 12, BaldUi.TEXT);
        context.drawCenteredTextWithShadow(textRenderer,
                BaldText.label("Original client-side modules · " + BaldLauncherClient.getModuleMenuKeyName()
                        + " to reopen"), width / 2, panelY + 31, BaldUi.MUTED);

        List<Entry> matches = matchingEntries();
        String hoverDescription = "Choose a category or search for an available Bald feature.";
        int gap = 6;
        int cardWidth = (panelWidth - 28 - gap) / 2;
        int firstY = panelY + 116;
        for (int index = 0; index < matches.size() && index < 8; index++) {
            int column = index % 2;
            int row = index / 2;
            int cardX = panelX + 14 + column * (cardWidth + gap);
            int cardY = firstY + row * 34;
            if (mouseX >= cardX && mouseX <= cardX + cardWidth
                    && mouseY >= cardY && mouseY <= cardY + 28) {
                hoverDescription = matches.get(index).description();
                break;
            }
        }
        context.drawCenteredTextWithShadow(textRenderer, BaldText.label(hoverDescription),
                width / 2, panelY + 307, BaldUi.MUTED);
        if (matches.isEmpty()) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label("No modules match this search."),
                    width / 2, panelY + 148, BaldUi.MUTED);
        }
        if (!feedback.isEmpty()) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label(feedback),
                    width / 2, panelY + 363, BaldUi.ACCENT);
        }
        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public boolean keyPressed(net.minecraft.client.input.KeyInput input) {
        if (search != null && search.keyPressed(input)) {
            searchText = search.getText();
            return true;
        }
        return super.keyPressed(input);
    }

    @Override
    public boolean charTyped(net.minecraft.client.input.CharInput input) {
        boolean handled = super.charTyped(input);
        if (handled && search != null) searchText = search.getText();
        return handled;
    }

    private enum Category {
        HUD("HUD"),
        INTERFACE("INTERFACE"),
        PERFORMANCE("PERFORMANCE");

        private final String label;

        Category(String label) {
            this.label = label;
        }
    }

    private record Entry(String name, String description,
                         Function<BaldLauncherClient.VisualPreferences, Boolean> enabled,
                         Function<BaldLauncherClient.VisualPreferences,
                                 BaldLauncherClient.VisualPreferences> update,
                         Runnable action) {}
}
