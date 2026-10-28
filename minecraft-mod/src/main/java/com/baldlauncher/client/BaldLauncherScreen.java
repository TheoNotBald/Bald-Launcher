package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

public abstract class BaldLauncherScreen extends Screen {
    private static boolean blurFallbackLogged;
    private static boolean glassFallbackLogged;
    private int glassSnapshotWidth = -1;
    private int glassSnapshotHeight = -1;
    private boolean glassSnapshotAttempted;

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
            String message = error.getMessage();
            if (!"Can only blur once per frame".equals(message)
                    && (message == null || !message.toLowerCase(java.util.Locale.ROOT).contains("blur"))) {
                throw error;
            }
            if (!blurFallbackLogged) {
                System.err.println("[Bald Launcher] Another screen already blurred this frame; using a darkened background.");
                blurFallbackLogged = true;
            }
            context.fill(0, 0, width, height, 0xB00A0D0B);
        }
    }

    protected final void resetGlassSnapshotCache() {
        glassSnapshotWidth = -1;
        glassSnapshotHeight = -1;
        glassSnapshotAttempted = false;
    }

    protected final void captureGlassSnapshot(int x, int y, int captureWidth, int captureHeight) {
        if (glassSnapshotAttempted && glassSnapshotWidth == width && glassSnapshotHeight == height) return;
        glassSnapshotAttempted = true;
        glassSnapshotWidth = width;
        glassSnapshotHeight = height;
        try {
            BaldUi.captureBackground(width, height, x, y, captureWidth, captureHeight);
        } catch (IllegalArgumentException | IllegalStateException error) {
            if (!glassFallbackLogged) {
                System.err.println("[Bald Launcher] Glass snapshot unavailable; using opaque menu panels: "
                        + error.getMessage());
                glassFallbackLogged = true;
            }
        }
    }
}
