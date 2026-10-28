package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.advancement.AdvancementsScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.StatsScreen;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

public final class BaldPauseScreen extends BaldLauncherScreen {
    private PauseLayout layout;

    public BaldPauseScreen() {
        super(Text.literal("Game Menu"));
    }

    @Override
    protected void init() {
        resetGlassSnapshotCache();
        sectionLabels.clear();
        layout = createLayout();
        int innerX = layout.panelX() + layout.inset();
        int innerWidth = layout.panelWidth() - layout.inset() * 2;
        int primaryWidth = (innerWidth - layout.gap()) / 2;
        addButton("Back to Game", innerX, layout.primaryY(), primaryWidth, layout.primaryHeight(),
                true, this::close);
        addButton("Save and Quit", innerX + primaryWidth + layout.gap(), layout.primaryY(),
                primaryWidth, layout.primaryHeight(), true,
                () -> client.disconnect(new net.minecraft.client.gui.screen.TitleScreen(), false));

        List<MenuAction> worldActions = List.of(
                new MenuAction("Advancements", () -> {
                    if (client.player != null) {
                        client.setScreen(new AdvancementsScreen(client.player.networkHandler.getAdvancementHandler()));
                    }
                }),
                new MenuAction("Statistics", () -> {
                    if (client.player != null) {
                        client.setScreen(new StatsScreen(this, client.player.getStatHandler()));
                    }
                }));
        List<MenuAction> baldActions = new ArrayList<>();
        if (BaldLauncherClient.isPerformanceButtonEnabled()) {
            baldActions.add(new MenuAction("Performance & UI",
                    () -> client.setScreen(new BaldPerformanceScreen(this))));
        }
        baldActions.add(new MenuAction("Modules", () -> client.setScreen(new BaldModuleMenuScreen(this))));
        baldActions.add(new MenuAction("Accounts", () -> client.setScreen(new BaldAccountScreen(this))));
        baldActions.add(new MenuAction("Cosmetics",
                () -> BaldLauncherClient.sendLauncherAction("open-cosmetics", null)));
        List<MenuAction> settingsActions = List.of(
                new MenuAction("Bald Settings",
                        () -> client.setScreen(new BaldPerformanceScreen(this))),
                new MenuAction("Options", () -> client.setScreen(new OptionsScreen(this, client.options))));

        if (layout.compact()) {
            addCompactSections(worldActions, baldActions, settingsActions, innerX, innerWidth);
        } else {
            addWideSections(worldActions, baldActions, settingsActions, innerX, innerWidth);
        }
    }

    private void addWideSections(List<MenuAction> worldActions, List<MenuAction> baldActions,
                                 List<MenuAction> settingsActions, int x, int width) {
        int sectionGap = layout.gap();
        int sectionWidth = (width - sectionGap * 2) / 3;
        int top = layout.sectionsY();
        addSection("WORLD", worldActions, x, top, sectionWidth, 1);
        addSection("BALD CLIENT", baldActions, x + sectionWidth + sectionGap,
                top, sectionWidth, 1);
        addSection("SETTINGS", settingsActions, x + (sectionWidth + sectionGap) * 2,
                top, sectionWidth, 1);
    }

    private void addCompactSections(List<MenuAction> worldActions, List<MenuAction> baldActions,
                                    List<MenuAction> settingsActions, int x, int width) {
        int firstWidth = (width - layout.gap()) / 2;
        int buttonY = layout.sectionsY() + layout.labelHeight();
        int buttonWidth = firstWidth;
        int rowHeight = layout.actionHeight() + layout.gap();
        addSectionLabel("WORLD", x, layout.sectionsY(), width);
        addActionRow(worldActions, x, buttonY, buttonWidth, 2);

        int baldLabelY = buttonY + rowHeight;
        addSectionLabel("BALD CLIENT", x, baldLabelY, width);
        int baldY = baldLabelY + layout.labelHeight();
        addActionRow(baldActions.subList(0, Math.min(2, baldActions.size())), x,
                baldY, buttonWidth, 2);
        if (baldActions.size() > 2) {
            addActionRow(baldActions.subList(2, baldActions.size()), x,
                    baldY + rowHeight, buttonWidth, 2);
        }

        int settingsLabelY = baldY + rowHeight * 2;
        addSectionLabel("SETTINGS", x, settingsLabelY, width);
        addActionRow(settingsActions, x, settingsLabelY + layout.labelHeight(), buttonWidth, 2);
    }

    private void addSection(String title, List<MenuAction> actions, int x, int top,
                            int sectionWidth, int columns) {
        addSectionLabel(title, x, top, sectionWidth);
        int buttonY = top + layout.labelHeight();
        int buttonWidth = (sectionWidth - layout.gap() * (columns - 1)) / columns;
        for (int index = 0; index < actions.size(); index++) {
            MenuAction action = actions.get(index);
            int row = index / columns;
            int column = index % columns;
            addButton(action.label(), x + column * (buttonWidth + layout.gap()),
                    buttonY + row * (layout.actionHeight() + layout.gap()),
                    buttonWidth, layout.actionHeight(), action.label().equals("Performance & UI"),
                    action.action());
        }
    }

    private void addActionRow(List<MenuAction> actions, int x, int y, int buttonWidth, int columns) {
        for (int index = 0; index < actions.size(); index++) {
            MenuAction action = actions.get(index);
            int row = index / columns;
            int column = index % columns;
            addButton(action.label(), x + column * (buttonWidth + layout.gap()),
                    y + row * (layout.actionHeight() + layout.gap()),
                    buttonWidth, layout.actionHeight(), action.label().equals("Performance & UI"),
                    action.action());
        }
    }

    private PauseLayout createLayout() {
        int panelWidth = Math.max(0, Math.min(720, width - 16));
        boolean compact = panelWidth < 560 || height < 320;
        boolean tiny = height < 170;
        int inset = tiny ? 4 : compact ? 7 : 16;
        int gap = tiny ? 2 : compact ? 3 : 7;
        int titleHeight = tiny ? 12 : compact ? 14 : 18;
        int primaryHeight = tiny ? 18 : compact ? 23 : 38;
        int actionHeight = tiny ? 16 : height < 200 ? 17 : compact ? 21 : 28;
        int labelHeight = tiny ? 8 : compact ? 10 : 14;
        int buttonRows = 4;
        int sectionsHeight = compact
                ? labelHeight * 3 + actionHeight * 4 + gap * 3
                : labelHeight + buttonRows * actionHeight + (buttonRows - 1) * gap;
        int panelHeight = inset + titleHeight + 5 + primaryHeight + 8 + sectionsHeight + inset;
        panelHeight = Math.min(height, panelHeight);
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(0, Math.min(height - panelHeight, (height - panelHeight) / 2));
        int primaryY = panelY + inset + titleHeight + 5;
        int sectionsY = primaryY + primaryHeight + 8;
        return new PauseLayout(panelX, panelY, panelWidth, panelHeight, inset, gap, compact,
                primaryY, primaryHeight, sectionsY, labelHeight, actionHeight);
    }

    private void addSectionLabel(String title, int x, int y, int sectionWidth) {
        if (y < 0 || y + layout.labelHeight() > height) return;
        contextLabel(title, x, y, sectionWidth);
    }

    private void contextLabel(String title, int x, int y, int sectionWidth) {
        sectionLabels.add(new SectionLabel(title, x, y, sectionWidth));
    }

    private final List<SectionLabel> sectionLabels = new ArrayList<>();

    private void addButton(String label, int x, int y, int buttonWidth, int buttonHeight,
                           boolean prominent, Runnable action) {
        if (buttonWidth <= 0 || buttonHeight <= 0 || x < 0 || y < 0
                || x + buttonWidth > width || y + buttonHeight > height) return;
        addDrawableChild(new GlassButtonWidget(x, y, buttonWidth, buttonHeight,
                Text.literal(label), prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        if (layout == null) layout = createLayout();
        captureGlassSnapshot(layout.panelX(), layout.panelY(), layout.panelWidth(), layout.panelHeight());
        BaldUi.drawPanel(context, layout.panelX(), layout.panelY(), layout.panelWidth(), layout.panelHeight());
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("PAUSED"),
                width / 2, layout.panelY() + layout.inset(), BaldUi.TEXT);
        for (SectionLabel label : sectionLabels) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label(label.title()),
                    label.x() + label.width() / 2, label.y(), BaldUi.MUTED);
        }
        super.render(context, mouseX, mouseY, delta);
    }

    private record MenuAction(String label, Runnable action) {}
    private record SectionLabel(String title, int x, int y, int width) {}
    private record PauseLayout(int panelX, int panelY, int panelWidth, int panelHeight, int inset, int gap,
                               boolean compact, int primaryY, int primaryHeight, int sectionsY,
                               int labelHeight, int actionHeight) {}

    @Override
    public void close() {
        if (client != null) client.setScreen(null);
    }
}
