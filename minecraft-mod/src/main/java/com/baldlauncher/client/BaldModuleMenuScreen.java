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
    private int entryPage;

    public BaldModuleMenuScreen(Screen parent) {
        super(Text.literal("Bald Modules"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int panelWidth = Math.max(0, Math.min(560, width - 16));
        int panelHeight = panelHeight();
        int panelX = (width - panelWidth) / 2;
        int panelY = (height - panelHeight) / 2;
        boolean compact = compactLayout();
        int inset = compact ? 10 : 14;
        int searchY = panelY + (compact ? 38 : 50);
        search = new TextFieldWidget(textRenderer, panelX + inset, searchY,
                panelWidth - inset * 2, compact ? 20 : 22, Text.literal("Search modules"));
        search.setPlaceholder(Text.literal("Search modules"));
        search.setMaxLength(64);
        search.setText(searchText);
        addDrawableChild(search);

        int tabY = panelY + (compact ? 65 : 80);
        int tabGap = compact ? 4 : 6;
        int tabWidth = (panelWidth - inset * 2 - tabGap * 2) / 3;
        Category[] categories = Category.values();
        for (int index = 0; index < categories.length; index++) {
            Category value = categories[index];
            addButton(value.label, panelX + inset + index * (tabWidth + tabGap), tabY,
                    tabWidth, compact ? 22 : 26,
                    value == category, () -> {
                        searchText = search.getText();
                        category = value;
                        clearAndInit();
                    });
        }

        List<Entry> matches = matchingEntries();
        int columns = panelWidth < 360 ? 1 : 2;
        int gap = compact ? 4 : 6;
        int cardWidth = (panelWidth - inset * 2 - gap * (columns - 1)) / columns;
        int firstY = panelY + (compact ? 116 : 116);
        int rowStep = compact ? 25 : 34;
        int cardHeight = compact ? 22 : 28;
        int footerY = panelY + panelHeight - (compact ? 32 : 36);
        int availableRows = Math.max(1, (footerY - firstY - 6) / rowStep);
        int pageCapacity = availableRows * columns;
        int pageCount = Math.max(1, (matches.size() + pageCapacity - 1) / pageCapacity);
        entryPage = Math.max(0, Math.min(entryPage, pageCount - 1));
        int startIndex = entryPage * pageCapacity;
        int endIndex = Math.min(matches.size(), startIndex + pageCapacity);
        for (int index = startIndex; index < endIndex; index++) {
            Entry entry = matches.get(index);
            int pageIndex = index - startIndex;
            int row = pageIndex / columns;
            int column = pageIndex % columns;
            int x = panelX + inset + column * (cardWidth + gap);
            int y = firstY + row * rowStep;
            if (entry.action() == null) {
                boolean value = entry.enabled().apply(BaldLauncherClient.getVisualPreferences());
                addButton(entry.name() + "  ·  " + (value ? "ON" : "OFF"), x, y,
                        cardWidth, cardHeight,
                        value, () -> toggle(entry));
            } else {
                addButton(entry.name(), x, y, cardWidth, cardHeight, false, entry.action());
            }
        }

        if (pageCount > 1) {
            int navY = panelY + (compact ? 92 : 108);
            int navWidth = 24;
            int center = panelX + panelWidth / 2;
            addButton("<", center - navWidth - 34, navY, navWidth, compact ? 18 : 20,
                    false, () -> changePage(-1));
            addButton(">", center + 10, navY, navWidth, compact ? 18 : 20,
                    false, () -> changePage(1));
        }

        int footerGap = compact ? 4 : 6;
        int footerColumns = BaldLauncherClient.isPerformanceButtonEnabled() ? 3 : 2;
        int footerWidth = (panelWidth - inset * 2 - footerGap * (footerColumns - 1)) / footerColumns;
        int footerHeight = compact ? 22 : 28;
        addButton("Edit HUD", panelX + inset, footerY, footerWidth, footerHeight, true,
                () -> client.setScreen(new BaldHudEditorScreen(this)));
        if (BaldLauncherClient.isPerformanceButtonEnabled()) {
            addButton("Performance & UI", panelX + inset + footerWidth + footerGap, footerY,
                    footerWidth, footerHeight, false, () -> client.setScreen(new BaldPerformanceScreen(this)));
        }
        addButton("Done", panelX + inset + (footerWidth + footerGap) * (footerColumns - 1), footerY,
                footerWidth, footerHeight, false, () -> client.setScreen(parent));
    }

    private int panelHeight() {
        return Math.max(0, Math.min(390, height - 16));
    }

    private boolean compactLayout() {
        return width < 580 || height < 430;
    }

    private void changePage(int amount) {
        entryPage += amount;
        clearAndInit();
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
        if (BaldLauncherClient.isPerformanceButtonEnabled()) {
            entries.add(new Entry("Performance & UI", "Bald HUD controls and Minecraft options",
                    null, null, () -> client.setScreen(new BaldPerformanceScreen(this))));
        }
        return entries;
    }

    private static Entry toggle(String name, String description,
                                Function<BaldLauncherClient.VisualPreferences, Boolean> enabled,
                                Function<BaldLauncherClient.VisualPreferences,
                                        BaldLauncherClient.VisualPreferences> update) {
        return new Entry(name, description, enabled, update, null);
    }

    private void toggle(Entry entry) {
        BaldLauncherClient.VisualPreferences current = BaldLauncherClient.getVisualPreferences();
        BaldLauncherClient.VisualPreferences updated = entry.update().apply(current);
        boolean menuChanged = current.menuEnabled() != updated.menuEnabled();
        boolean performanceButtonChanged =
                current.performanceButtonEnabled() != updated.performanceButtonEnabled();
        try {
            BaldLauncherClient.saveVisualPreferences(updated);
            feedback = "Saved to this game profile";
            if (menuChanged || performanceButtonChanged) {
                BaldLauncherClient.refreshMenuAfterToggle();
                return;
            }
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
        int panelWidth = Math.max(0, Math.min(560, width - 16));
        int panelHeight = panelHeight();
        int panelX = (width - panelWidth) / 2;
        int panelY = (height - panelHeight) / 2;
        BaldUi.drawPanel(context, panelX, panelY, panelWidth, panelHeight);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("BALD MODULES"),
                width / 2, panelY + 12, BaldUi.TEXT);
        context.drawCenteredTextWithShadow(textRenderer,
                BaldText.label("Original client-side modules · " + BaldLauncherClient.getModuleMenuKeyName()
                        + " to reopen"), width / 2, panelY + 31, BaldUi.MUTED);

        List<Entry> matches = matchingEntries();
        String hoverDescription = "Choose a category or search for an available Bald feature.";
        boolean compact = compactLayout();
        int inset = compact ? 10 : 14;
        int columns = panelWidth < 360 ? 1 : 2;
        int gap = compact ? 4 : 6;
        int cardWidth = (panelWidth - inset * 2 - gap * (columns - 1)) / columns;
        int firstY = panelY + 116;
        int rowStep = compact ? 25 : 34;
        int footerY = panelY + panelHeight - (compact ? 32 : 36);
        int availableRows = Math.max(1, (footerY - firstY - 6) / rowStep);
        int pageCapacity = availableRows * columns;
        int pageCount = Math.max(1, (matches.size() + pageCapacity - 1) / pageCapacity);
        int startIndex = Math.min(entryPage, pageCount - 1) * pageCapacity;
        int endIndex = Math.min(matches.size(), startIndex + pageCapacity);
        for (int index = startIndex; index < endIndex; index++) {
            int pageIndex = index - startIndex;
            int column = pageIndex % columns;
            int row = pageIndex / columns;
            int cardX = panelX + inset + column * (cardWidth + gap);
            int cardY = firstY + row * rowStep;
            if (mouseX >= cardX && mouseX <= cardX + cardWidth
                    && mouseY >= cardY && mouseY <= cardY + (compact ? 22 : 28)) {
                hoverDescription = matches.get(index).description();
                break;
            }
        }
        context.drawCenteredTextWithShadow(textRenderer, BaldText.label(hoverDescription),
                width / 2, panelY + panelHeight - (compact ? 54 : 58), BaldUi.MUTED);
        if (pageCount > 1) {
            context.drawCenteredTextWithShadow(textRenderer,
                    BaldText.label("PAGE " + (Math.min(entryPage, pageCount - 1) + 1) + " / " + pageCount),
                    width / 2, panelY + (compact ? 96 : 111), BaldUi.MUTED);
        }
        if (matches.isEmpty()) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label("No modules match this search."),
                    width / 2, panelY + 148, BaldUi.MUTED);
        }
        if (!feedback.isEmpty()) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label(feedback),
                    width / 2, panelY + panelHeight - 15, BaldUi.ACCENT);
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
