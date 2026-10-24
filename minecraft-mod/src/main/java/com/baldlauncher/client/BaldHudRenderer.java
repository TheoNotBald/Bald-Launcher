package com.baldlauncher.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.PlayerListEntry;

import java.util.ArrayList;
import java.util.List;

public final class BaldHudRenderer {
    public record HudWidget(String id, String label, String value, int x, int y, int width, int height, float scale) {}

    public static final String IN_GAME_BUTTON_ID = "inGameButton";

    private static final WidgetValue[] WIDGETS = {
            new WidgetValue("fps", "FPS"),
            new WidgetValue("frameTime", "FRAME TIME"),
            new WidgetValue("ping", "PING"),
            new WidgetValue("memory", "MEMORY"),
            new WidgetValue("coordinates", "COORDINATES"),
            new WidgetValue("cps", "CPS"),
            new WidgetValue("keystrokes", "KEYSTROKES")
    };
    private static long previousFrameNanos;

    private BaldHudRenderer() {}

    public static void render(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null || client.currentScreen != null) {
            previousFrameNanos = 0;
            return;
        }
        if (BaldLauncherClient.isInGameButtonEnabled()) {
            drawLauncherButton(context, client);
        }
        if (BaldLauncherClient.isPerformanceHudEnabled()) {
            renderWidgets(context, false, null);
        }
    }

    public static void renderEditorPreview(DrawContext context, String selectedId) {
        renderWidgets(context, true, selectedId);
    }

    public static List<HudWidget> getWidgets() {
        MinecraftClient client = MinecraftClient.getInstance();
        List<HudWidget> widgets = new ArrayList<>();
        if (client.player == null || client.world == null) return widgets;
        updateWidgetValues();
        widgets.add(getInGameButtonWidget(client));
        for (WidgetValue value : WIDGETS) {
            int textWidth = client.textRenderer.getWidth(BaldText.label(value.value));
            int width = Math.max(42, (textWidth + 18));
            int height = client.textRenderer.fontHeight + 8;
            float scale = BaldHudLayout.getScale(value.id);
            int scaledWidth = Math.round(width * scale);
            int scaledHeight = Math.round(height * scale);
            BaldHudLayout.Position position = BaldHudLayout.getPosition(
                    value.id, client.getWindow().getScaledWidth(), client.getWindow().getScaledHeight(),
                    scaledWidth, scaledHeight);
            widgets.add(new HudWidget(value.id, value.label, value.value,
                    position.x(), position.y(), scaledWidth, scaledHeight, scale));
        }
        return widgets;
    }

    private static void renderWidgets(DrawContext context, boolean editorPreview, String selectedId) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null) return;
        updateWidgetValues();
        HudWidget button = getInGameButtonWidget(client);
        if (editorPreview) {
            drawLauncherButton(context, client, button, selectedId.equals(IN_GAME_BUTTON_ID));
        }
        for (WidgetValue value : WIDGETS) {
            if (!editorPreview && !isWidgetEnabled(value.id)) continue;
            HudWidget widget = findWidget(value.id, value.label, value.value, client);
            boolean selected = editorPreview && value.id.equals(selectedId);
            drawWidgetSurface(context, widget);
            if (selected) {
                BaldUi.outline(context, widget.x() - 2, widget.y() - 2,
                        widget.x() + widget.width() + 2, widget.y() + widget.height() + 2,
                        8, BaldLauncherClient.getHudAccentColor());
            }
            context.getMatrices().pushMatrix();
            context.getMatrices().translate(widget.x(), widget.y());
            context.getMatrices().scale(widget.scale(), widget.scale());
            context.drawTextWithShadow(client.textRenderer, BaldText.label(value.value), 8, 4, BaldUi.TEXT);
            context.getMatrices().popMatrix();
        }
    }

    private static void drawWidgetSurface(DrawContext context, HudWidget widget) {
        int accent = BaldLauncherClient.getHudAccentColor();
        if (BaldLauncherClient.isHudCardStyleEnabled()) {
            BaldUi.rounded(context, widget.x(), widget.y(), widget.x() + widget.width(),
                    widget.y() + widget.height(), 7, 0xE9101519);
            BaldUi.outline(context, widget.x(), widget.y(), widget.x() + widget.width(),
                    widget.y() + widget.height(), 7, 0xB0000000 | (accent & 0x00FFFFFF));
            context.fill(widget.x() + 8, widget.y() + 1,
                    widget.x() + widget.width() - 8, widget.y() + 2, 0x16FFFFFF);
        } else {
            BaldUi.rounded(context, widget.x(), widget.y(), widget.x() + 2,
                    widget.y() + widget.height(), 1, accent);
        }
    }

    public static HudWidget getInGameButtonWidget() {
        MinecraftClient client = MinecraftClient.getInstance();
        return getInGameButtonWidget(client);
    }

    private static HudWidget getInGameButtonWidget(MinecraftClient client) {
        float scale = BaldHudLayout.getScale(IN_GAME_BUTTON_ID);
        int width = Math.round(26 * scale);
        int height = Math.round(26 * scale);
        BaldHudLayout.Position position = BaldHudLayout.getPosition(
                IN_GAME_BUTTON_ID, client.getWindow().getScaledWidth(),
                client.getWindow().getScaledHeight(), width, height);
        return new HudWidget(IN_GAME_BUTTON_ID, "Bald button", "B",
                position.x(), position.y(), width, height, scale);
    }

    private static HudWidget findWidget(String id, String label, String value, MinecraftClient client) {
        int contentWidth = client.textRenderer.getWidth(BaldText.label(value)) + 18;
        int contentHeight = client.textRenderer.fontHeight + 8;
        float scale = BaldHudLayout.getScale(id);
        int width = Math.max(42, Math.round(contentWidth * scale));
        int height = Math.max(18, Math.round(contentHeight * scale));
        BaldHudLayout.Position position = BaldHudLayout.getPosition(
                id, client.getWindow().getScaledWidth(), client.getWindow().getScaledHeight(), width, height);
        return new HudWidget(id, label, value, position.x(), position.y(), width, height, scale);
    }

    private static void updateWidgetValues() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null) return;

        long now = System.nanoTime();
        long frameNanos = previousFrameNanos == 0 ? 0 : now - previousFrameNanos;
        previousFrameNanos = now;
        PlayerListEntry playerEntry = client.getNetworkHandler() == null ? null
                : client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
        Runtime runtime = Runtime.getRuntime();
        String coordinates = client.player.getBlockX() + ", " + client.player.getBlockY()
                + ", " + client.player.getBlockZ();
        String keys = keyState(client);
        WIDGETS[0].value = client.getCurrentFps() + " FPS";
        WIDGETS[1].value = formatFrameTime(frameNanos);
        WIDGETS[2].value = playerEntry == null || playerEntry.getLatency() < 0
                ? "PING  --" : "PING  " + playerEntry.getLatency() + " ms";
        WIDGETS[3].value = "MEMORY  " + (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
                + " / " + runtime.maxMemory() / (1024 * 1024) + " MB";
        WIDGETS[4].value = "XYZ  " + coordinates;
        WIDGETS[5].value = "CPS  " + BaldLauncherClient.getClicksPerSecond();
        WIDGETS[6].value = keys;
    }

    private static String keyState(MinecraftClient client) {
        return (client.options.forwardKey.isPressed() ? "[W]" : " W ")
                + (client.options.leftKey.isPressed() ? "[A]" : " A ")
                + (client.options.backKey.isPressed() ? "[S]" : " S ")
                + (client.options.rightKey.isPressed() ? "[D]" : " D ")
                + (client.options.jumpKey.isPressed() ? " JUMP " : "");
    }

    private static boolean isWidgetEnabled(String id) {
        return switch (id) {
            case "fps" -> BaldLauncherClient.isFpsHudEnabled();
            case "frameTime" -> BaldLauncherClient.isFrameTimeHudEnabled();
            case "ping" -> BaldLauncherClient.isPingHudEnabled();
            case "memory" -> BaldLauncherClient.isMemoryHudEnabled();
            case "coordinates" -> BaldLauncherClient.isCoordinatesHudEnabled();
            case "cps" -> BaldLauncherClient.isCpsHudEnabled();
            case "keystrokes" -> BaldLauncherClient.isKeystrokesHudEnabled();
            default -> false;
        };
    }

    private static void drawLauncherButton(DrawContext context, MinecraftClient client) {
        drawLauncherButton(context, client, getInGameButtonWidget(client), false);
    }

    private static void drawLauncherButton(DrawContext context, MinecraftClient client,
                                           HudWidget widget, boolean selected) {
        int accent = BaldLauncherClient.getHudAccentColor();
        BaldUi.rounded(context, widget.x(), widget.y(), widget.x() + widget.width(),
                widget.y() + widget.height(), 7, selected ? 0xFF294746 : 0xFF151C20);
        BaldUi.outline(context, widget.x(), widget.y(), widget.x() + widget.width(),
                widget.y() + widget.height(), 7,
                selected ? accent : (0xB0000000 | (accent & 0x00FFFFFF)));
        if (selected) {
            BaldUi.outline(context, widget.x() - 2, widget.y() - 2,
                    widget.x() + widget.width() + 2, widget.y() + widget.height() + 2,
                    8, accent);
        }
        context.getMatrices().pushMatrix();
        context.getMatrices().translate(widget.x(), widget.y());
        context.getMatrices().scale(widget.scale(), widget.scale());
        context.drawCenteredTextWithShadow(client.textRenderer, BaldText.label("B"),
                13, 8, accent);
        context.getMatrices().popMatrix();
    }

    private static String formatFrameTime(long frameNanos) {
        if (frameNanos <= 0) return "FRAME  --";
        long tenthsOfMillis = (frameNanos + 50_000L) / 100_000L;
        return "FRAME  " + tenthsOfMillis / 10 + "." + tenthsOfMillis % 10 + " ms";
    }

    private static final class WidgetValue {
        private final String id;
        private final String label;
        private String value = "";

        private WidgetValue(String id, String label) {
            this.id = id;
            this.label = label;
        }
    }
}
