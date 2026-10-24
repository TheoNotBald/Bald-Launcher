package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

public final class BaldAccountConfirmScreen extends BaldLauncherScreen {
    private final Screen parent;
    private final BaldLauncherClient.Account account;

    public BaldAccountConfirmScreen(Screen parent, BaldLauncherClient.Account account) {
        super(Text.literal("Restart to switch account?"));
        this.parent = parent;
        this.account = account;
    }

    @Override
    protected void init() {
        int panelWidth = Math.min(420, this.width - 32);
        int width = panelWidth - 32;
        int x = (this.width - panelWidth) / 2 + 16;
        int y = this.height / 2 - 2;
        addGlassButton("Restart into " + account.name(), x, y, width, 30, true,
                () -> BaldLauncherClient.sendLauncherAction("switch-account", account.id()));
        addGlassButton("Cancel", x, y + 36, width, 28, false,
                () -> client.setScreen(new BaldAccountScreen(parent)));
    }

    private void addGlassButton(String label, int x, int y, int width, int height,
                                boolean prominent, Runnable action) {
        addDrawableChild(new GlassButtonWidget(x, y, width, height, BaldText.label(label), prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        int panelWidth = Math.min(420, width - 32);
        int panelHeight = 156;
        int panelX = (width - panelWidth) / 2;
        int panelY = height / 2 - 80;
        BaldUi.drawPanel(context, panelX, panelY, panelWidth, panelHeight);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("RESTART MINECRAFT?"),
                width / 2, panelY + 18, BaldUi.TEXT);
        context.drawCenteredTextWithShadow(textRenderer,
                BaldText.label("The game will reopen as " + account.name() + "."),
                width / 2, panelY + 42, BaldUi.MUTED);
        super.render(context, mouseX, mouseY, delta);
    }
}
