package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;

public final class GlassButtonWidget extends ClickableWidget {
    private final Runnable action;
    private final boolean prominent;
    private float hoverAmount;

    public GlassButtonWidget(int x, int y, int width, int height, Text label, boolean prominent, Runnable action) {
        super(x, y, width, height, BaldText.button(label.getString(), prominent));
        this.prominent = prominent;
        this.action = action;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        float targetHover = isHovered() || isFocused() ? 1.0f : 0.0f;
        float transition = Math.min(1.0f, 0.22f + Math.max(0.0f, delta) * 0.55f);
        hoverAmount += (targetHover - hoverAmount) * transition;
        if (Math.abs(targetHover - hoverAmount) < 0.01f) hoverAmount = targetHover;
        int x = getX();
        int y = getY();
        BaldUi.drawButton(context, x, y, width, height, prominent, hoverAmount, active);

        Text label = getMessage();
        int textColor = active
                ? BaldUi.blendColor(BaldUi.TEXT, 0xFFFFFFFF, hoverAmount)
                : 0xFF929A9C;
        context.drawCenteredTextWithShadow(MinecraftClient.getInstance().textRenderer, label,
                x + width / 2, y + (height - MinecraftClient.getInstance().textRenderer.fontHeight) / 2,
                textColor);
    }

    @Override
    public void onClick(net.minecraft.client.gui.Click click, boolean doubleClick) {
        if (active) action.run();
    }

    @Override
    protected void appendClickableNarrations(NarrationMessageBuilder builder) {
        appendDefaultNarrations(builder);
    }
}
