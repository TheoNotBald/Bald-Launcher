package com.baldlauncher.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.PlayerSkinDrawer;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.world.SelectWorldScreen;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

public final class BaldMainMenuScreen extends BaldLauncherScreen {
    private SkinTextures currentSkin;
    private MenuLayout layout;

    public BaldMainMenuScreen() {
        super(Text.literal("Bald Launcher"));
    }

    @Override
    protected void init() {
        resetGlassSnapshotCache();
        MinecraftClient minecraft = MinecraftClient.getInstance();
        minecraft.getSkinProvider().fetchSkinTextures(minecraft.getGameProfile())
                .thenAccept(skin -> skin.ifPresent(textures -> minecraft.execute(() -> {
                    if (minecraft.currentScreen == this) currentSkin = textures;
                })));

        layout = createLayout();
        int left = layout.panelX() + layout.inset();
        int primaryWidth = (layout.panelWidth() - layout.inset() * 2 - layout.gap()) / 2;
        addButton("Singleplayer", left, layout.primaryY(), primaryWidth, layout.primaryHeight(), true,
                () -> client.setScreen(new SelectWorldScreen(this)));
        addButton("Multiplayer", left + primaryWidth + layout.gap(), layout.primaryY(),
                primaryWidth, layout.primaryHeight(), true,
                () -> client.setScreen(new MultiplayerScreen(this)));

        List<MenuAction> actions = new ArrayList<>();
        if (BaldLauncherClient.isPerformanceButtonEnabled()) {
            actions.add(new MenuAction("Performance & UI",
                    () -> client.setScreen(new BaldPerformanceScreen(this))));
        }
        actions.add(new MenuAction("Modules", () -> client.setScreen(new BaldModuleMenuScreen(this))));
        actions.add(new MenuAction("Accounts", () -> client.setScreen(new BaldAccountScreen(this))));
        actions.add(new MenuAction("Cosmetics",
                () -> BaldLauncherClient.sendLauncherAction("open-cosmetics", null)));

        int actionWidth = (layout.panelWidth() - layout.inset() * 2
                - layout.gap() * (layout.columns() - 1)) / layout.columns();
        for (int index = 0; index < actions.size(); index++) {
            MenuAction action = actions.get(index);
            int row = index / layout.columns();
            int column = index % layout.columns();
            addButton(action.label(), left + column * (actionWidth + layout.gap()),
                    layout.actionsY() + row * (layout.actionHeight() + layout.gap()),
                    actionWidth, layout.actionHeight(), false, action.action());
        }
        int footerWidth = (layout.panelWidth() - layout.inset() * 2 - layout.gap() * 2) / 3;
        addButton("Bald Settings", left, layout.footerY(), footerWidth, layout.footerHeight(), false,
                () -> client.setScreen(new BaldPerformanceScreen(this)));
        addButton("Options", left + footerWidth + layout.gap(), layout.footerY(),
                footerWidth, layout.footerHeight(), false,
                () -> client.setScreen(new OptionsScreen(this, client.options)));
        addButton("Quit Game", left + (footerWidth + layout.gap()) * 2, layout.footerY(),
                footerWidth, layout.footerHeight(), false, client::scheduleStop);
    }

    private MenuLayout createLayout() {
        int panelWidth = Math.max(0, Math.min(780, width - 20));
        int inset = width < 420 || height < 300 ? 8 : 16;
        int gap = width < 420 || height < 300 ? 4 : 8;
        int columns = panelWidth < 520 ? 2 : 4;
        int actionCount = BaldLauncherClient.isPerformanceButtonEnabled() ? 4 : 3;
        int rows = (actionCount + columns - 1) / columns;
        boolean tiny = height < 170;
        boolean compact = height < 300;
        int titleHeight = tiny ? 12 : compact ? 14 : 18;
        int primaryHeight = tiny ? 20 : compact ? 24 : 40;
        int actionHeight = tiny ? 16 : compact ? 21 : 30;
        int footerHeight = tiny ? 18 : compact ? 20 : 28;
        if (tiny) {
            inset = 4;
            gap = 2;
        }
        int panelHeight = inset + titleHeight + 5 + primaryHeight + 8
                + 12 + 4 + rows * actionHeight + (rows - 1) * gap
                + 6 + footerHeight + inset;
        panelHeight = Math.min(height, panelHeight);
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(0, Math.min(height - panelHeight, (height - panelHeight) / 2));
        int primaryY = panelY + inset + titleHeight + 5;
        int actionsY = primaryY + primaryHeight + 8 + 12 + 4;
        int footerY = panelY + panelHeight - inset - footerHeight;
        return new MenuLayout(panelX, panelY, panelWidth, panelHeight, inset, gap, columns,
                primaryY, primaryHeight, actionsY, actionHeight, footerY, footerHeight);
    }

    private void addButton(String label, int x, int y, int buttonWidth, int buttonHeight,
                           boolean prominent, Runnable action) {
        if (buttonWidth <= 0 || buttonHeight <= 0 || y < 0 || y + buttonHeight > height) return;
        addDrawableChild(new GlassButtonWidget(x, y, buttonWidth, buttonHeight,
                Text.literal(label), prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        if (layout == null) layout = createLayout();
        captureGlassSnapshot(layout.panelX(), layout.panelY(), layout.panelWidth(), layout.panelHeight());
        BaldUi.drawPanel(context, layout.panelX(), layout.panelY(), layout.panelWidth(), layout.panelHeight());

        int titleY = layout.panelY() + layout.inset();
        context.drawTextWithShadow(textRenderer, BaldText.title("BALD LAUNCHER"),
                layout.panelX() + layout.inset(), titleY, BaldUi.TEXT);
        String playerName = BaldLauncherClient.getPlayerName();
        int nameWidth = textRenderer.getWidth(playerName);
        int nameX = layout.panelX() + layout.panelWidth() - layout.inset() - nameWidth;
        if (currentSkin != null && layout.panelWidth() > 500 && height > 300) {
            PlayerSkinDrawer.draw(context, currentSkin, nameX - 26, titleY - 2, 20);
            nameX -= 28;
        }
        context.drawTextWithShadow(textRenderer, BaldText.label(playerName),
                nameX, titleY + 2, 0xFFE5ECEC);
        context.fill(layout.panelX() + layout.inset(), layout.primaryY() - 4,
                layout.panelX() + layout.panelWidth() - layout.inset(), layout.primaryY() - 3,
                0x664F6769);
        context.drawTextWithShadow(textRenderer, BaldText.label("BALD CLIENT"),
                layout.panelX() + layout.inset(), layout.actionsY() - 14, BaldUi.MUTED);
        super.render(context, mouseX, mouseY, delta);
    }

    private record MenuAction(String label, Runnable action) {}

    private record MenuLayout(int panelX, int panelY, int panelWidth, int panelHeight, int inset, int gap,
                              int columns, int primaryY, int primaryHeight, int actionsY,
                              int actionHeight, int footerY, int footerHeight) {}

    @Override
    public boolean shouldCloseOnEsc() {
        return false;
    }
}
