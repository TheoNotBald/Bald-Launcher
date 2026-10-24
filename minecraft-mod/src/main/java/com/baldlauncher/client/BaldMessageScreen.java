package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

public final class BaldMessageScreen extends BaldLauncherScreen {
    private final Text message;

    public BaldMessageScreen(Text message) {
        super(Text.literal("Bald Launcher"));
        this.message = message;
    }

    @Override
    protected void init() {
        addDrawableChild(new GlassButtonWidget((width - 200) / 2, height / 2 + 12,
                200, 30, BaldText.label("Back"), false, () -> client.setScreen(new BaldMainMenuScreen())));
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBaldBackground(context, mouseX, mouseY, delta);
        int panelWidth = Math.min(420, width - 32);
        int panelHeight = 108;
        int panelX = (width - panelWidth) / 2;
        int panelY = (height - panelHeight) / 2;
        BaldUi.drawPanel(context, panelX, panelY, panelWidth, panelHeight);
        context.drawCenteredTextWithShadow(textRenderer, message,
                width / 2, panelY + 35, BaldUi.TEXT);
        super.render(context, mouseX, mouseY, delta);
    }
}
