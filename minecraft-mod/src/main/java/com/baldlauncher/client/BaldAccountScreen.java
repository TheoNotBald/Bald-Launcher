package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

public final class BaldAccountScreen extends BaldLauncherScreen {
    private final Screen parent;

    public BaldAccountScreen(Screen parent) {
        super(Text.literal("Switch Account"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int panelWidth = Math.min(380, this.width - 32);
        int panelHeight = Math.min(this.height - 42, 88 + BaldLauncherClient.getAccounts().size() * 33);
        int panelX = (this.width - panelWidth) / 2;
        int panelY = Math.max(21, (this.height - panelHeight) / 2);
        int x = panelX + 12;
        int y = panelY + 48;
        int buttonWidth = panelWidth - 24;
        for (BaldLauncherClient.Account account : BaldLauncherClient.getAccounts()) {
            String label = account.name() + (account.id().equals(BaldLauncherClient.getActiveAccountId()) ? " (Current)" : "");
            addGlassButton(label, x, y, buttonWidth, 28, false, () -> {
                if (account.id().equals(BaldLauncherClient.getActiveAccountId())) return;
                client.setScreen(new BaldAccountConfirmScreen(parent, account));
            });
            y += 33;
        }
        addGlassButton("Back", x, Math.min(y + 4, this.height - 38), buttonWidth, 28, false,
                () -> client.setScreen(parent));
    }

    private void addGlassButton(String label, int x, int y, int width, int height,
                                boolean prominent, Runnable action) {
        addDrawableChild(new GlassButtonWidget(x, y, width, height, BaldText.label(label), prominent, action));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        int panelWidth = Math.min(380, width - 32);
        int panelHeight = Math.min(height - 42, 88 + BaldLauncherClient.getAccounts().size() * 33);
        int panelX = (width - panelWidth) / 2;
        int panelY = Math.max(21, (height - panelHeight) / 2);
        BaldUi.drawPanel(context, panelX, panelY, panelWidth, panelHeight);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("CHOOSE ACCOUNT"),
                width / 2, panelY + 14, BaldUi.TEXT);
        context.drawCenteredTextWithShadow(textRenderer,
                BaldText.label("Switching restarts Minecraft"), width / 2, panelY + 34, BaldUi.MUTED);
        super.render(context, mouseX, mouseY, delta);
    }
}
