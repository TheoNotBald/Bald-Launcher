package com.baldlauncher.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;

import java.util.List;

public final class BaldHudEditorScreen extends BaldLauncherScreen {
    private final Screen parent;
    private String selectedId = BaldHudRenderer.IN_GAME_BUTTON_ID;
    private String draggingId;
    private int dragOffsetX;
    private int dragOffsetY;
    private String feedback = "";

    public BaldHudEditorScreen() {
        this(null);
    }

    public BaldHudEditorScreen(Screen parent) {
        super(net.minecraft.text.Text.literal("Bald HUD Editor"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        List<BaldHudRenderer.HudWidget> widgets = BaldHudRenderer.getWidgets();
        if (widgets.stream().noneMatch(widget -> widget.id().equals(selectedId))) {
            selectedId = widgets.isEmpty() ? null : widgets.getFirst().id();
        }
        int buttonY = height - 44;
        int gap = 6;
        int buttonWidth = Math.min(116, (width - 32 - gap * 3) / 4);
        int totalWidth = buttonWidth * 4 + gap * 3;
        int x = (width - totalWidth) / 2;
        addButton("− Size", x, buttonY, buttonWidth, () -> changeScale(-0.1f));
        addButton("+ Size", x + buttonWidth + gap, buttonY, buttonWidth, () -> changeScale(0.1f));
        addButton("Reset widget", x + (buttonWidth + gap) * 2, buttonY, buttonWidth, this::resetSelected);
        addButton("Done", x + (buttonWidth + gap) * 3, buttonY, buttonWidth, this::close);
    }

    private void addButton(String label, int x, int y, int width, Runnable action) {
        boolean prominent = label.equals("Done");
        addDrawableChild(new BaldClientButtonWidget(x, y, width, 28,
                BaldText.button(label, prominent), prominent, prominent, action));
    }

    private void changeScale(float difference) {
        if (selectedId == null) {
            feedback = "Enable a HUD element or the Bald button first";
            return;
        }
        float scale = Math.max(0.75f, Math.min(2.0f, BaldHudLayout.getScale(selectedId) + difference));
        try {
            BaldHudRenderer.HudWidget widget = findSelected();
            BaldHudLayout.savePosition(selectedId, widget.x(), widget.y(), width, height,
                    widget.width(), widget.height(), scale);
        } catch (Exception error) {
            showSaveError(error);
        }
    }

    private void resetSelected() {
        if (selectedId == null) {
            feedback = "There are no enabled widgets to reset";
            return;
        }
        try {
            BaldHudLayout.reset(selectedId);
            feedback = "Widget restored";
        } catch (Exception error) {
            showSaveError(error);
        }
    }

    private BaldHudRenderer.HudWidget findSelected() {
        if (selectedId == null) {
            throw new IllegalStateException("No enabled HUD widget is available.");
        }
        return BaldHudRenderer.getWidgets().stream()
                .filter(widget -> widget.id().equals(selectedId))
                .findFirst().orElseThrow(() -> new IllegalStateException("Selected HUD widget is unavailable."));
    }

    private void showSaveError(Exception error) {
        feedback = "Could not save layout: " + error.getMessage();
        System.err.println("[Bald Launcher] Could not save HUD layout: " + error.getMessage());
    }

    @Override
    public boolean mouseClicked(net.minecraft.client.gui.Click click, boolean doubleClick) {
        if (isToolbarClick(click.x(), click.y())) return super.mouseClicked(click, doubleClick);
        if (click.button() == 0) {
            List<BaldHudRenderer.HudWidget> widgets = BaldHudRenderer.getWidgets();
            for (int index = widgets.size() - 1; index >= 0; index--) {
                BaldHudRenderer.HudWidget widget = widgets.get(index);
                if (click.x() >= widget.x() && click.x() <= widget.x() + widget.width()
                        && click.y() >= widget.y() && click.y() <= widget.y() + widget.height()) {
                    selectedId = widget.id();
                    draggingId = widget.id();
                    dragOffsetX = (int) click.x() - widget.x();
                    dragOffsetY = (int) click.y() - widget.y();
                    return true;
                }
            }
        }
        return super.mouseClicked(click, doubleClick);
    }

    private boolean isToolbarClick(double mouseX, double mouseY) {
        int gap = 6;
        int buttonWidth = Math.min(116, (width - 32 - gap * 3) / 4);
        int totalWidth = buttonWidth * 4 + gap * 3;
        int left = (width - totalWidth) / 2;
        int top = height - 44;
        if (mouseY < top || mouseY > top + 28) return false;
        for (int index = 0; index < 4; index++) {
            int buttonX = left + index * (buttonWidth + gap);
            if (mouseX >= buttonX && mouseX <= buttonX + buttonWidth) return true;
        }
        return false;
    }

    @Override
    public boolean mouseDragged(net.minecraft.client.gui.Click click, double deltaX, double deltaY) {
        if (draggingId != null && click.button() == 0) {
            BaldHudRenderer.HudWidget widget = findSelected();
            int maxX = Math.max(0, width - widget.width());
            int maxY = Math.max(0, height - widget.height());
            int x = snapToEdge((int) click.x() - dragOffsetX, maxX);
            int y = snapToEdge((int) click.y() - dragOffsetY, maxY);
            BaldHudLayout.previewPosition(draggingId, x, y, width, height,
                    widget.width(), widget.height(), widget.scale());
            return true;
        }
        return super.mouseDragged(click, deltaX, deltaY);
    }

    private static int snapToEdge(int position, int maxPosition) {
        int clamped = Math.max(0, Math.min(maxPosition, position));
        if (clamped <= 8) return 0;
        if (maxPosition - clamped <= 8) return maxPosition;
        return clamped;
    }

    @Override
    public boolean mouseReleased(net.minecraft.client.gui.Click click) {
        if (click.button() == 0 && draggingId != null) {
            try {
                BaldHudLayout.persist(draggingId);
                feedback = "Layout saved";
            } catch (Exception error) {
                showSaveError(error);
            }
            draggingId = null;
            return true;
        }
        return super.mouseReleased(click);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        for (BaldHudRenderer.HudWidget widget : BaldHudRenderer.getWidgets()) {
            if (mouseX >= widget.x() && mouseX <= widget.x() + widget.width()
                    && mouseY >= widget.y() && mouseY <= widget.y() + widget.height()) {
                selectedId = widget.id();
                changeScale(verticalAmount > 0 ? 0.1f : -0.1f);
                return true;
            }
        }
        return super.mouseScrolled(mouseX, mouseY, horizontalAmount, verticalAmount);
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        context.fill(0, 0, width, height, 0x58070C10);
        BaldHudRenderer.renderEditorPreview(context, selectedId);
        context.drawCenteredTextWithShadow(textRenderer, BaldText.title("HUD EDITOR"),
                width / 2, 14, BaldUi.TEXT);
        context.drawCenteredTextWithShadow(textRenderer,
                BaldText.label("Drag to move · Scroll or use − / + to resize · " + selectedLabel()),
                width / 2, 34, BaldUi.MUTED);
        if (!feedback.isEmpty()) {
            context.drawCenteredTextWithShadow(textRenderer, BaldText.label(feedback),
                    width / 2, height - 62, BaldUi.ACCENT);
        }
        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }

    private String selectedLabel() {
        if (selectedId == null) return "NO ENABLED WIDGETS";
        return switch (selectedId) {
            case BaldHudRenderer.IN_GAME_BUTTON_ID -> "BALD BUTTON";
            case "fps" -> "FPS";
            case "frameTime" -> "FRAME TIME";
            case "ping" -> "PING";
            case "memory" -> "MEMORY";
            case "coordinates" -> "COORDINATES";
            case "cps" -> "CPS";
            case "keystrokes" -> "KEYSTROKES";
            default -> "HUD ELEMENT";
        };
    }

    @Override
    public void close() {
        if (draggingId != null) {
            try {
                BaldHudLayout.persist(draggingId);
            } catch (Exception error) {
                showSaveError(error);
            }
            draggingId = null;
        }
        if (client != null) client.setScreen(parent);
    }
}
