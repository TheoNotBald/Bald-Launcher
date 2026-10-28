package com.baldlauncher.client;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.systems.RenderPass;
import com.mojang.blaze3d.textures.GpuTexture;
import com.mojang.blaze3d.textures.FilterMode;
import java.util.OptionalInt;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.client.texture.AbstractTexture;
import net.minecraft.client.gl.SimpleFramebuffer;
import net.minecraft.util.Identifier;

public final class BaldUi {
    public static final int ACCENT = 0xFF8FC8C7;
    public static final int TEXT = 0xFFF0F5F4;
    public static final int MUTED = 0xFFB1C0BE;
    private static final Identifier GLASS_TEXTURE_ID = Identifier.of("baldlauncher", "ui/glass_snapshot");
    private static final int BORDER = 0x738FC8C7;
    private static final int BORDER_HIGHLIGHT = 0xC3E4F8F5;
    private static GlassFramebufferTexture glassTexture;
    private static int glassTextureWidth;
    private static int glassTextureHeight;
    private static int glassOriginX;
    private static int glassOriginY;
    private static int glassRegionWidth;
    private static int glassRegionHeight;
    private static float glassScaleX;
    private static float glassScaleY;

    private BaldUi() {}

    public static void captureBackground(int screenWidth, int screenHeight,
                                         int x, int y, int width, int height) {
        glassRegionWidth = 0;
        glassRegionHeight = 0;
        MinecraftClient client = MinecraftClient.getInstance();
        Framebuffer framebuffer = client.getFramebuffer();
        GpuTexture source = framebuffer.getColorAttachment();
        if (source == null) throw new IllegalStateException("Minecraft framebuffer has no color attachment.");

        int framebufferWidth = source.getWidth(0);
        int framebufferHeight = source.getHeight(0);
        if (screenWidth <= 0 || screenHeight <= 0 || framebufferWidth <= 0 || framebufferHeight <= 0) {
            throw new IllegalStateException("Cannot capture glass background from an empty framebuffer.");
        }

        int left = Math.max(0, x - 4);
        int top = Math.max(0, y - 4);
        int right = Math.min(screenWidth, x + width + 4);
        int bottom = Math.min(screenHeight, y + height + 4);
        if (right <= left || bottom <= top) {
            throw new IllegalArgumentException("Glass capture region is outside the screen.");
        }

        double scaleX = framebufferWidth / (double) screenWidth;
        double scaleY = framebufferHeight / (double) screenHeight;
        int sourceX = (int) Math.floor(left * scaleX);
        int sourceY = (int) Math.floor(top * scaleY);
        int sourceRight = Math.min(framebufferWidth, (int) Math.ceil(right * scaleX));
        int sourceBottom = Math.min(framebufferHeight, (int) Math.ceil(bottom * scaleY));

        if (glassTexture == null || glassTextureWidth != framebufferWidth
                || glassTextureHeight != framebufferHeight) {
            if (glassTexture != null) client.getTextureManager().destroyTexture(GLASS_TEXTURE_ID);
            glassTexture = new GlassFramebufferTexture(framebufferWidth, framebufferHeight);
            glassTextureWidth = framebufferWidth;
            glassTextureHeight = framebufferHeight;
            client.getTextureManager().registerTexture(GLASS_TEXTURE_ID, glassTexture);
        }

        try (RenderPass renderPass = RenderSystem.getDevice().createCommandEncoder()
                .createRenderPass(() -> "Bald Launcher glass snapshot",
                        glassTexture.getGlTextureView(), OptionalInt.empty())) {
            renderPass.setPipeline(RenderPipelines.TRACY_BLIT);
            renderPass.bindTexture("InSampler", framebuffer.getColorAttachmentView(),
                    RenderSystem.getSamplerCache().get(FilterMode.NEAREST));
            renderPass.draw(0, 3);
        }
        glassOriginX = left;
        glassOriginY = top;
        glassRegionWidth = sourceRight - sourceX;
        glassRegionHeight = sourceBottom - sourceY;
        glassScaleX = (float) scaleX;
        glassScaleY = (float) scaleY;
    }

    public static void drawPanel(DrawContext context, int x, int y, int width, int height) {
        int right = x + width;
        int bottom = y + height;
        drawGlassSample(context, x + 8, y + 8, width - 16, height - 16, 0);
        rounded(context, x - 1, y + 2, right + 1, bottom + 4, 14, 0x35000000);
        rounded(context, x, y, right, bottom, 12, 0xA0141B20);
        outline(context, x, y, right, bottom, 12, BORDER);
        rounded(context, x + 1, y + 1, right - 1, y + 3, 11, 0x16FFFFFF);
    }

    public static void drawButton(DrawContext context, int x, int y, int width, int height,
                                  boolean prominent, float hoverAmount, boolean active) {
        int right = x + width;
        int bottom = y + height;
        int radius = Math.min(12, height / 2);
        float hover = active ? Math.max(0.0f, Math.min(1.0f, hoverAmount)) : 0.0f;
        int fill = !active ? 0x18151B20
                : blendColor(prominent ? 0x2299C7C3 : 0x1899BDB9,
                prominent ? 0x3CC8E7E2 : 0x30B8D9D5, hover);
        rounded(context, x - 1, y + 1, right + 1, bottom + 3, radius + 1, 0x18000000);
        rounded(context, x, y, right, bottom, radius, fill);
        outline(context, x, y, right, bottom, radius,
                !active ? 0x408FC8C7 : blendColor(BORDER, BORDER_HIGHLIGHT, hover));
        outline(context, x + 1, y + 1, right - 1, bottom - 1,
                Math.max(1, radius - 1), blendColor(0x18E7FAF8, 0x2EEBFFFF, hover));
        int highlight = blendColor(0x20FFFFFF, 0x2CFFFFFF, hover);
        rounded(context, x + 2, y + 1, right - 2, y + Math.max(3, height / 3),
                Math.max(1, radius - 2), highlight);
        context.fill(x + radius, y + 1, right - radius, y + 2,
                blendColor(0x88E3F8F5, 0xBFFFFFFF, hover));
        context.fill(x + radius, bottom - 2, right - radius, bottom - 1,
                blendColor(0x3293C7C3, 0x56FFFFFF, hover));
    }

    private static void drawGlassSample(DrawContext context, int x, int y, int width, int height,
                                       float hover) {
        if (width <= 0 || height <= 0 || glassTexture == null || glassScaleX <= 0 || glassScaleY <= 0
                || x < glassOriginX || y < glassOriginY
                || x + width > glassOriginX + glassRegionWidth / glassScaleX
                || y + height > glassOriginY + glassRegionHeight / glassScaleY) {
            return;
        }
        float u = x * glassScaleX;
        float v = y * glassScaleY;
        int sampleWidth = Math.max(1, Math.round(width * glassScaleX));
        int sampleHeight = Math.max(1, Math.round(height * glassScaleY));
        int tint = blendColor(0x66DDE9E6, 0x80F4F8F6, hover);
        context.drawTexture(RenderPipelines.GUI_TEXTURED, GLASS_TEXTURE_ID,
                x, y, u, v, width, height, sampleWidth, sampleHeight,
                glassTextureWidth, glassTextureHeight, tint);
    }

    public static int blendColor(int from, int to, float amount) {
        float blend = Math.max(0.0f, Math.min(1.0f, amount));
        int alpha = Math.round(((from >>> 24) & 0xFF) * (1.0f - blend)
                + ((to >>> 24) & 0xFF) * blend);
        int red = Math.round(((from >>> 16) & 0xFF) * (1.0f - blend)
                + ((to >>> 16) & 0xFF) * blend);
        int green = Math.round(((from >>> 8) & 0xFF) * (1.0f - blend)
                + ((to >>> 8) & 0xFF) * blend);
        int blue = Math.round((from & 0xFF) * (1.0f - blend) + (to & 0xFF) * blend);
        return alpha << 24 | red << 16 | green << 8 | blue;
    }

    public static void rounded(DrawContext context, int left, int top, int right, int bottom,
                              int radius, int color) {
        if (right <= left || bottom <= top) return;
        int safeRadius = Math.max(0, Math.min(radius, Math.min((right - left) / 2, (bottom - top) / 2)));
        for (int row = 0; row < bottom - top; row++) {
            int inset = cornerInset(row, bottom - top, safeRadius);
            context.fill(left + inset, top + row, right - inset, top + row + 1, color);
        }
    }

    public static void outline(DrawContext context, int left, int top, int right, int bottom,
                               int radius, int color) {
        if (right <= left || bottom <= top) return;
        int width = right - left;
        int height = bottom - top;
        int safeRadius = Math.max(0, Math.min(radius, Math.min(width / 2, height / 2)));
        for (int row = 0; row < height; row++) {
            int outerInset = cornerInset(row, height, safeRadius);
            int innerRow = row - 1;
            if (innerRow < 0 || innerRow >= height - 2) {
                context.fill(left + outerInset, top + row, right - outerInset, top + row + 1, color);
                continue;
            }
            int innerInset = cornerInset(innerRow, height - 2, Math.max(0, safeRadius - 1));
            int outerLeft = left + outerInset;
            int outerRight = right - outerInset;
            int innerLeft = left + 1 + innerInset;
            int innerRight = right - 1 - innerInset;
            context.fill(outerLeft, top + row, Math.min(outerRight, innerLeft), top + row + 1, color);
            context.fill(Math.max(outerLeft, innerRight), top + row, outerRight, top + row + 1, color);
        }
    }

    private static int cornerInset(int row, int height, int radius) {
        if (radius == 0 || row >= radius && row < height - radius) return 0;
        int distance = row < radius ? row : height - row - 1;
        double offset = radius - distance - 0.5;
        return radius - (int) Math.floor(Math.sqrt(radius * radius - offset * offset));
    }

    private static final class GlassFramebufferTexture extends AbstractTexture {
        private final Framebuffer framebuffer;

        private GlassFramebufferTexture(int width, int height) {
            framebuffer = new SimpleFramebuffer("Bald Launcher glass background", width, height, false);
            glTexture = framebuffer.getColorAttachment();
            glTextureView = framebuffer.getColorAttachmentView();
            sampler = RenderSystem.getSamplerCache().get(FilterMode.LINEAR);
        }

        @Override
        public void close() {
            framebuffer.delete();
            glTexture = null;
            glTextureView = null;
            sampler = null;
        }
    }
}
