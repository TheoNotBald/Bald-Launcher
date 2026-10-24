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

    public BaldMainMenuScreen() {
        super(Text.literal("Bald Launcher"));
    }

    @Override
    protected void init() {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        minecraft.getSkinProvider().fetchSkinTextures(minecraft.getGameProfile())
                .thenAccept(skin -> skin.ifPresent(textures -> minecraft.execute(() -> {
                    if (minecraft.currentScreen == this) currentSkin = textures;
                })));

        int panelWidth = Math.min(780, this.width - 32);
        int panelX = (this.width - panelWidth) / 2;
        int inset = 16;
        int primaryGap = 10;
        int primaryWidth = (panelWidth - inset * 2 - primaryGap) / 2;
        int panelTop = panelTop(this.height, panelHeight(panelWidth));
        int primaryY = panelTop + 30;
        int primaryHeight = 44;
        addGlassButton("Singleplayer", panelX + inset, primaryY, primaryWidth, primaryHeight, true,
                () -> client.setScreen(new SelectWorldScreen(this)));
        addGlassButton("Multiplayer", panelX + inset + primaryWidth + primaryGap, primaryY,
                primaryWidth, primaryHeight, true, () -> client.setScreen(new MultiplayerScreen(this)));

        List<MenuAction> actions = new ArrayList<>();
        actions.add(new MenuAction("Cosmetics",
                () -> BaldLauncherClient.sendLauncherAction("open-cosmetics", null)));
        actions.add(new MenuAction("Performance & UI",
                () -> client.setScreen(new BaldPerformanceScreen(this))));
        actions.add(new MenuAction("Modules",
                () -> client.setScreen(new BaldModuleMenuScreen(this))));
        actions.add(new MenuAction("Accounts", () -> client.setScreen(new BaldAccountScreen(this))));
        actions.add(new MenuAction("Options", () -> client.setScreen(new OptionsScreen(this, client.options))));
        int columns = panelWidth < 420 ? 2 : panelWidth < 590 ? 3 : 4;
        int actionGap = 6;
        int actionWidth = (panelWidth - inset * 2 - actionGap * (columns - 1)) / columns;
        int actionY = primaryY + primaryHeight + 10;
        for (int i = 0; i < actions.size(); i++) {
            MenuAction action = actions.get(i);
            int row = i / columns;
            int column = i % columns;
            addGlassButton(action.label(), panelX + inset + column * (actionWidth + actionGap),
                    actionY + row * 38, actionWidth, 32, false, action.action());
        }
        int rows = (actions.size() + columns - 1) / columns;
        int quitY = actionY + rows * 32 + (rows - 1) * 6 + 8;
        addGlassButton("Quit Game", (this.width - 148) / 2, quitY,
                148, 28, false, client::scheduleStop);
    }

    private static int panelHeight(int panelWidth) {
        int actionCount = 5;
        int columns = panelWidth < 420 ? 2 : panelWidth < 590 ? 3 : 4;
        int rows = (actionCount + columns - 1) / columns;
        return 85 + rows * 32 + (rows - 1) * 6 + 8 + 28;
    }

    private int panelTop(int screenHeight, int panelHeight) {
        return Math.max(105, (screenHeight - panelHeight) / 2 - 40);
    }

    private void addGlassButton(String label, int x, int y, int width, int height,
                                boolean prominent, Runnable action) {
        addDrawableChild(new GlassButtonWidget(x, y, width, height, Text.literal(label), prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        int captureWidth = Math.min(780, width - 32);
        int captureX = (width - captureWidth) / 2;
        int captureHeight = panelHeight(captureWidth);
        int captureY = panelTop(height, captureHeight);
        BaldUi.captureBackground(width, height,
                captureX + 12, captureY + 26, captureWidth - 24, captureHeight - 10);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("BALD LAUNCHER"),
                width / 2, 52, BaldUi.TEXT);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.label("Your Minecraft, your way"),
                width / 2, 75, BaldUi.MUTED);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.label("Made by TheoNotBald"),
                width / 2, 93, BaldUi.ACCENT);

        if (currentSkin != null) {
            PlayerSkinDrawer.draw(context, currentSkin, width - 62, 22, 24);
            drawPlayerName(context, 54);
        } else {
            drawPlayerName(context, 39);
        }
        super.render(context, mouseX, mouseY, delta);
    }

    private void drawPlayerName(DrawContext context, int y) {
        Text playerName = BaldText.label(BaldLauncherClient.getPlayerName());
        context.drawTextWithShadow(textRenderer, playerName,
                width - 16 - textRenderer.getWidth(playerName), y, 0xFFE5ECEC);
    }

    private record MenuAction(String label, Runnable action) {}

    @Override
    public boolean shouldCloseOnEsc() {
        return false;
    }
}
