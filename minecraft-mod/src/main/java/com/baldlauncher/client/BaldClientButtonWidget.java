package com.baldlauncher.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;

public final class BaldClientButtonWidget extends ClickableWidget {
    private final Runnable action;
    private final boolean selected;
    private final boolean prominent;
    private float hoverAmount;

    public BaldClientButtonWidget(int x, int y, int width, int height, Text label,
                                  boolean selected, boolean prominent, Runnable action) {
        super(x, y, width, height, label);
        this.selected = selected;
        this.prominent = prominent;
        this.action = action;
    }

    @Override
    protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        float targetHover = isHovered() || isFocused() ? 1.0f : 0.0f;
        float transition = Math.min(1.0f, 0.2f + Math.max(0.0f, delta) * 0.6f);
        hoverAmount += (targetHover - hoverAmount) * transition;
        if (Math.abs(targetHover - hoverAmount) < 0.01f) hoverAmount = targetHover;

        int x = getX();
        int y = getY();
        int right = x + width;
        int bottom = y + height;
        int radius = Math.min(8, height / 2);
        int accent = BaldLauncherClient.getHudAccentColor();
        int fill = prominent
                ? (selected ? 0xFF8FC8C7 : 0xFF254A49)
                : (selected ? 0xFF203536 : 0xFF171D22);
        int hoverFill = prominent
                ? (selected ? 0xFFA7D9D6 : 0xFF315B59)
                : (selected ? 0xFF2B4445 : 0xFF252E33);
        fill = BaldUi.blendColor(fill, hoverFill, hoverAmount);

        BaldUi.rounded(context, x, y, right, bottom, radius, active ? fill : 0xFF14191D);
        BaldUi.rounded(context, x + 1, y + 1, right - 1, y + 3,
                Math.max(1, radius - 1), active ? 0x12FFFFFF : 0x08000000);
        int border = selected || prominent
                ? (0xA0000000 | (accent & 0x00FFFFFF))
                : (isHovered() ? 0xFF526D6C : 0xFF30383D);
        BaldUi.outline(context, x, y, right, bottom, radius,
                active ? border : 0xFF252B2F);

        int textColor = prominent && selected ? 0xFF102021 : 0xFFE7EEED;
        if (!active) textColor = 0xFF87908F;
        context.drawCenteredTextWithShadow(MinecraftClient.getInstance().textRenderer,
                getMessage(), x + width / 2,
                y + (height - MinecraftClient.getInstance().textRenderer.fontHeight) / 2,
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
