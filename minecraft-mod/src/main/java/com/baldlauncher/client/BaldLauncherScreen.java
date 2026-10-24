package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

public abstract class BaldLauncherScreen extends Screen {
    private static boolean blurFallbackLogged;

    protected BaldLauncherScreen(Text title) {
        super(title);
    }

    protected final void renderBaldBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        if (MinecraftClient.getInstance().world != null) {
            context.fill(0, 0, width, height, 0x24070C10);
            return;
        }
        try {
            renderBackground(context, mouseX, mouseY, delta);
        } catch (IllegalStateException error) {
            if (!"Can only blur once per frame".equals(error.getMessage())) throw error;
            if (!blurFallbackLogged) {
                System.err.println("[Bald Launcher] Another screen already blurred this frame; using a darkened background.");
                blurFallbackLogged = true;
            }
            context.fill(0, 0, width, height, 0xB00A0D0B);
        }
    }
}
