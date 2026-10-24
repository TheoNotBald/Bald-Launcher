package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.advancement.AdvancementsScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.StatsScreen;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

public final class BaldPauseScreen extends BaldLauncherScreen {
    public BaldPauseScreen() {
        super(Text.literal("Game Menu"));
    }

    @Override
    protected void init() {
        int panelWidth = Math.min(660, this.width - 32);
        int x = (this.width - panelWidth) / 2;
        int columns = panelWidth < 460 ? 2 : 3;
        int actionCount = getActionCount();
        int panelHeight = panelHeight(actionCount, columns);
        int y = Math.max(28, (this.height - panelHeight) / 2);
        int gap = 8;
        int actionWidth = (panelWidth - 36 - gap) / 2;
        addGlassButton("Back to Game", x + 18, y + 37, actionWidth, 40, true, this::close);
        addGlassButton("Save and Quit", x + 18 + actionWidth + gap, y + 37,
                actionWidth, 40, true,
                () -> client.disconnect(new net.minecraft.client.gui.screen.TitleScreen(), false));

        List<MenuAction> gameActions = new ArrayList<>();
        gameActions.add(new MenuAction("Advancements", () -> {
            if (client.player != null) {
                client.setScreen(new AdvancementsScreen(client.player.networkHandler.getAdvancementHandler()));
            }
        }));
        gameActions.add(new MenuAction("Statistics", () -> {
            if (client.player != null) {
                client.setScreen(new StatsScreen(this, client.player.getStatHandler()));
            }
        }));
        List<MenuAction> baldActions = List.of(
                new MenuAction("Cosmetics", () -> BaldLauncherClient.sendLauncherAction("open-cosmetics", null)),
                new MenuAction("Accounts", () -> client.setScreen(new BaldAccountScreen(this))));
        List<MenuAction> settingsActions = List.of(
                new MenuAction("Modules", () -> client.setScreen(new BaldModuleMenuScreen(this))),
                new MenuAction("Performance & UI", () -> client.setScreen(new BaldPerformanceScreen(this))),
                new MenuAction("Options", () -> client.setScreen(new OptionsScreen(this, client.options))));

        int actionGap = 6;
        int smallWidth = (panelWidth - 36 - actionGap * (columns - 1)) / columns;
        int smallHeight = 30;
        int smallY = y + 100;
        if (columns == 3) {
            addColumn(gameActions, 0, x, smallY, smallWidth, actionGap, smallHeight);
            addColumn(baldActions, 1, x, smallY, smallWidth, actionGap, smallHeight);
            addColumn(settingsActions, 2, x, smallY, smallWidth, actionGap, smallHeight);
        } else {
            List<MenuAction> compactActions = new ArrayList<>();
            compactActions.addAll(gameActions);
            compactActions.addAll(baldActions);
            compactActions.addAll(settingsActions);
            for (int i = 0; i < compactActions.size(); i++) {
                MenuAction action = compactActions.get(i);
                addGlassButton(action.label(), x + 18 + (i % columns) * (smallWidth + actionGap),
                        smallY + (i / columns) * (smallHeight + 6), smallWidth, smallHeight,
                        action.label().equals("Performance & UI"), action.action());
            }
        }
    }

    private void addColumn(List<MenuAction> actions, int column, int panelX, int top,
                           int width, int gap, int height) {
        int panelWidth = Math.min(660, this.width - 32);
        int columnWidth = (panelWidth - 36 - gap * 2) / 3;
        for (int row = 0; row < actions.size(); row++) {
            MenuAction action = actions.get(row);
            addGlassButton(action.label(), panelX + 18 + column * (columnWidth + gap),
                    top + row * (height + 6), width, height,
                    action.label().equals("Performance & UI"), action.action());
        }
    }

    private void addGlassButton(String label, int x, int y, int width, int height,
                                boolean prominent, Runnable action) {
        addDrawableChild(new GlassButtonWidget(x, y, width, height, Text.literal(label), prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        int panelWidth = Math.min(660, width - 32);
        int columns = panelWidth < 460 ? 2 : 3;
        int panelHeight = panelHeight(getActionCount(), columns);
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(28, (height - panelHeight) / 2);
        BaldUi.captureBackground(width, height,
                panelX + 14, panelY + 33, panelWidth - 28, panelHeight - 27);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("PAUSED"),
                width / 2, panelY + 12, BaldUi.TEXT);
        if (columns == 3) {
            int groupWidth = (panelWidth - 36 - 12) / 3;
            drawSectionLabel(context, "WORLD", panelX + 18, panelY + 85, groupWidth);
            drawSectionLabel(context, "BALD CLIENT", panelX + 18 + groupWidth + 6,
                    panelY + 85, groupWidth);
            drawSectionLabel(context, "SETTINGS", panelX + 18 + (groupWidth + 6) * 2,
                    panelY + 85, groupWidth);
        }
        super.render(context, mouseX, mouseY, delta);
    }

    private void drawSectionLabel(DrawContext context, String label, int x, int y, int width) {
        context.drawCenteredTextWithShadow(textRenderer, BaldText.label(label),
                x + width / 2, y, BaldUi.MUTED);
    }

    private record MenuAction(String label, Runnable action) {}

    private int getActionCount() {
        return 7;
    }

    private static int panelHeight(int actionCount, int columns) {
        int rows = (actionCount + columns - 1) / columns;
        return 94 + rows * 38;
    }

    @Override
    public void close() {
        if (client != null) client.setScreen(null);
    }
}
