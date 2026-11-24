package bl.ui;

import java.lang.invoke.MethodHandles;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Predicate;

import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

import bl.Bl;
import bl.mc.RuntimeMappings;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

/**
 * Bald Agent's Meteor-style module menu.
 *
 * <p>The screen is generated at runtime because the agent must extend the
 * namespace-specific {@code Screen}. The visual layer is a compact set of
 * purple-headed columns; vanilla screens are never touched.</p>
 */
public final class ClickGui {

    private static final int GAP = 6;
    private static final int HEADER_HEIGHT = 20;
    private static final int ROW_HEIGHT = 16;
    private static final int[] PALETTE = {
            0xFF913DE2, 0xFFB66CFF, 0xFF6A2BB0, 0xFFFF6B9D,
            0xFF4FA8FF, 0xFF3DE0B0, 0xFFF7C948, 0xFFFF6B6B
    };
    private static final Category[] CATEGORIES = {
            Category.COMBAT, Category.PLAYER, Category.MOVEMENT,
            Category.RENDER, Category.WORLD, Category.MISC
    };

    private Object minecraft;
    private Object parent;
    private Object menu;
    private Method setScreen;
    private Field currentScreen;
    private Class<?> screenType;
    private Class<?> menuType;
    private Method renderMethod;
    private Field fontField;
    private Field widthField;
    private Field heightField;
    private Method mouseXMethod;
    private Method mouseYMethod;
    private Method mouseButtonMethod;
    private Method keyCodeMethod;
    private Ui ui;
    private int namespace;

    private String search = "";
    private boolean searchFocused;
    private Module detailsModule;
    private Setting draggingSetting;
    private int draggingLeft;
    private int draggingRight;
    private Setting bindingSetting;
    private Module bindingModule;
    private double detailsScroll;
    private String toast = "";
    private long toastUntil;
    private boolean uiFailureReported;

    private final double[] columnScroll = new double[CATEGORIES.length + 1];
    private final boolean[] columnCollapsed = new boolean[CATEGORIES.length];
    private final List<Hit> hits = new ArrayList<>();
    private final List<ScrollArea> scrollAreas = new ArrayList<>();

    private record Hit(int x1, int y1, int x2, int y2, int button, Runnable action) {
    }

    private enum ScrollTarget {
        COLUMN, DETAILS
    }

    private record ScrollArea(int x1, int y1, int x2, int y2,
            ScrollTarget target, int column, double max) {
    }

    private record Layout(int x, int y, int width, int height,
            int columnWidth, int headerHeight, int footerY) {
    }

    public void toggle(Object source, int runtimeNamespace) {
        try {
            if (source == null || runtimeNamespace < 0 || runtimeNamespace > 1) {
                throw new IllegalStateException("Missing Minecraft keyboard context");
            }
            if (menu != null && currentScreen() == menu) {
                close();
                return;
            }
            initialize(source.getClass().getClassLoader(), runtimeNamespace);
            parent = currentScreen();
            if (parent == menu) {
                parent = null;
            }
            if (menuType == null) {
                menuType = createMenuType();
            }
            menu = menuType.getDeclaredConstructor().newInstance();
            if (ui == null) {
                ui = new Ui(renderMethod.getParameterTypes()[0], fontField, menu);
            } else {
                ui.bind(menu);
            }
            resetState();
            show(menu);
        } catch (Throwable error) {
            clearMenu();
            System.err.println("[Bald Agent] Could not open module dashboard: " + error);
            error.printStackTrace(System.err);
        }
    }

    public boolean isOpen() {
        return menu != null && currentScreen() == menu;
    }

    public void tick() {
        if (menu != null && currentScreen() != menu) {
            clearMenu();
        }
    }

    public void overlayMessage() {
    }

    public void close() {
        if (menu == null) {
            return;
        }
        Object back = parent;
        clearMenu();
        try {
            show(back);
        } catch (Throwable error) {
            System.err.println("[Bald Agent] Could not close module dashboard: " + error);
            error.printStackTrace(System.err);
        }
    }

    /** Routes every drawing call to the overlay display list instead of the game's framebuffer. */
    public void setRecording(boolean value) {
        if (ui != null) {
            ui.recording(value);
        }
    }

    public int[] screenSize(Object screen) {
        if (screen == null || widthField == null || heightField == null) {
            return new int[] { 0, 0 };
        }
        try {
            return new int[] { widthField.getInt(screen), heightField.getInt(screen) };
        } catch (Exception error) {
            return new int[] { 0, 0 };
        }
    }

    public void render(Object screen, Object graphics, int mouseX, int mouseY, float delta) {
        if (menu == null || graphics == null || uiFailureReported) {
            return;
        }
        try {
            if (Bl.get() == null) {
                Bl.init();
            }
            hits.clear();
            scrollAreas.clear();
            int screenWidth = widthField.getInt(screen);
            int screenHeight = heightField.getInt(screen);
            Layout layout = layout(screenWidth, screenHeight);
            drawBackdrop(graphics, screenWidth, screenHeight);
            drawColumns(graphics, layout, screenWidth, mouseX, mouseY);
            drawFooter(graphics, layout, mouseX, mouseY);
            if (detailsModule != null) {
                drawDetails(graphics, screenWidth, screenHeight, mouseX, mouseY);
            }
            drawToast(graphics, layout);
        } catch (Throwable error) {
            reportFailure("render the module dashboard", error);
        }
    }

    public void click(Object screen, Object event) {
        if (menu == null || uiFailureReported) {
            return;
        }
        try {
            int button = ((Number) mouseButtonMethod.invoke(event)).intValue();
            double mouseX = ((Number) mouseXMethod.invoke(event)).doubleValue();
            double mouseY = ((Number) mouseYMethod.invoke(event)).doubleValue();
            if (button != 0 && button != 1) {
                return;
            }
            for (int index = hits.size() - 1; index >= 0; index--) {
                Hit hit = hits.get(index);
                if (mouseX < hit.x1 || mouseX >= hit.x2 || mouseY < hit.y1 || mouseY >= hit.y2) {
                    continue;
                }
                if (hit.button >= 0 && hit.button != button) {
                    continue;
                }
                draggingSetting = null;
                searchFocused = false;
                bindingModule = null;
                bindingSetting = null;
                hit.action.run();
                return;
            }
            draggingSetting = null;
            searchFocused = false;
            bindingModule = null;
            bindingSetting = null;
        } catch (Throwable error) {
            reportFailure("handle dashboard input", error);
        }
    }

    public boolean mouseDragged(Object event) {
        if (draggingSetting == null) {
            return false;
        }
        try {
            double mouseX = ((Number) mouseXMethod.invoke(event)).doubleValue();
            updateSlider(draggingSetting, mouseX, draggingLeft, draggingRight);
            return true;
        } catch (Throwable error) {
            reportFailure("drag numeric setting", error);
            return false;
        }
    }

    public boolean mouseReleased() {
        if (draggingSetting == null) {
            return false;
        }
        draggingSetting = null;
        Bl.saveConfiguration();
        return true;
    }

    public boolean keyPressed(Object event) {
        if (menu == null || keyCodeMethod == null) {
            return false;
        }
        try {
            int key = ((Number) keyCodeMethod.invoke(event)).intValue();
            if (bindingModule != null || bindingSetting != null) {
                handleBindingKey(key);
                return true;
            }
            if (searchFocused) {
                return handleSearchKey(key);
            }
            if (key == 256) {
                if (detailsModule != null) {
                    closeDetails();
                } else {
                    close();
                }
                return true;
            }
            if (key == 344) {
                close();
                return true;
            }
            return false;
        } catch (Throwable error) {
            reportFailure("read dashboard key input", error);
            return false;
        }
    }

    public boolean scroll(Object screen, double mouseX, double mouseY, double vertical) {
        if (menu == null || vertical == 0.0) {
            return false;
        }
        for (ScrollArea area : scrollAreas) {
            if (detailsModule != null && area.target != ScrollTarget.DETAILS) {
                continue;
            }
            if (mouseX < area.x1 || mouseX >= area.x2 || mouseY < area.y1 || mouseY >= area.y2) {
                continue;
            }
            double delta = vertical * 26.0;
            if (area.target == ScrollTarget.DETAILS) {
                detailsScroll = clamp(detailsScroll - delta, 0.0, area.max);
            } else {
                int column = Math.max(0, Math.min(columnScroll.length - 1, area.column));
                columnScroll[column] = clamp(columnScroll[column] - delta, 0.0, area.max);
            }
            return true;
        }
        return false;
    }

    private Layout layout(int screenWidth, int screenHeight) {
        int margin = Math.max(8, Math.min(22, screenWidth / 80));
        int available = Math.max(140, screenWidth - margin * 2);
        int width = Math.max(36, Math.min(150, (available - GAP * 6) / 7));
        int boardWidth = width * 7 + GAP * 6;
        int boardX = Math.max(0, (screenWidth - boardWidth) / 2);
        int boardY = Math.max(8, Math.min(18, screenHeight / 40));
        int boardHeight = Math.max(120, Math.min(600, screenHeight - boardY - 48));
        return new Layout(boardX, boardY, boardWidth, boardHeight, width, HEADER_HEIGHT,
                boardY + boardHeight + 6);
    }

    private void drawBackdrop(Object graphics, int screenWidth, int screenHeight) {
        ui.gradient(graphics, 0, 0, screenWidth, screenHeight,
                Theme.BACKDROP_TOP, Theme.BACKDROP_BOTTOM);
        ui.fill(graphics, 0, 0, screenWidth, 1, Theme.withAlpha(Theme.ACCENT, 80));
    }

    private void drawColumns(Object graphics, Layout layout, int screenWidth,
            int mouseX, int mouseY) {
        for (int index = 0; index < CATEGORIES.length; index++) {
            int x = layout.x() + index * (layout.columnWidth() + GAP);
            drawColumn(graphics, layout, index, x, mouseX, mouseY);
        }
        int searchX = layout.x() + CATEGORIES.length * (layout.columnWidth() + GAP);
        drawSearchColumn(graphics, layout, searchX, mouseX, mouseY);
    }

    private void drawColumn(Object graphics, Layout layout, int index, int x,
            int mouseX, int mouseY) {
        Category category = CATEGORIES[index];
        List<Module> modules = categoryModules(category);
        boolean collapsed = columnCollapsed[index];
        drawHeader(graphics, x, layout.y(), layout.columnWidth(), categoryName(category),
                collapsed ? "+" : Integer.toString(modules.size()), collapsed,
                () -> {
                    columnCollapsed[index] = !columnCollapsed[index];
                    columnScroll[index] = 0.0;
                }, mouseX, mouseY);
        if (collapsed) {
            return;
        }

        int bodyTop = layout.y() + layout.headerHeight();
        int bodyBottom = layout.y() + layout.height() - 3;
        ui.fill(graphics, x, bodyTop, x + layout.columnWidth(), layout.y() + layout.height(),
                Theme.COLUMN);
        ui.fill(graphics, x + layout.columnWidth() - 1, bodyTop,
                x + layout.columnWidth(), layout.y() + layout.height(), Theme.LINE_SOFT);

        int viewHeight = Math.max(1, bodyBottom - bodyTop);
        int contentHeight = modules.size() * ROW_HEIGHT + 6;
        double maxScroll = Math.max(0.0, contentHeight - viewHeight);
        columnScroll[index] = clamp(columnScroll[index], 0.0, maxScroll);

        boolean clipped = ui.canScissor();
        if (clipped) {
            ui.scissor(graphics, x + 1, bodyTop, x + layout.columnWidth() - 2, bodyBottom);
        }
        int cursor = bodyTop + 3 - (int) Math.round(columnScroll[index]);
        for (Module module : modules) {
            int rowBottom = cursor + ROW_HEIGHT;
            if (rowBottom >= bodyTop - 2 && cursor <= bodyBottom + 2) {
                if (clipped || (cursor >= bodyTop && rowBottom <= bodyBottom)) {
                    drawModuleRow(graphics, module, x + 1, cursor,
                            layout.columnWidth() - 3, mouseX, mouseY,
                            bodyTop, bodyBottom, layout.columnWidth() >= 96);
                }
            }
            cursor += ROW_HEIGHT;
        }
        if (clipped) {
            ui.unscissor(graphics);
        }
        if (modules.isEmpty()) {
            ui.textCentered(graphics, "No modules", x + layout.columnWidth() / 2,
                    bodyTop + 10, Theme.TEXT_DIM);
        }
        if (maxScroll > 0.5) {
            scrollAreas.add(new ScrollArea(x + 2, bodyTop, x + layout.columnWidth() - 2,
                    bodyBottom, ScrollTarget.COLUMN, index, maxScroll));
            drawScrollbar(graphics, x + layout.columnWidth() - 4, bodyTop, bodyBottom,
                    columnScroll[index], maxScroll);
        }
    }

    private void drawSearchColumn(Object graphics, Layout layout, int x,
            int mouseX, int mouseY) {
        List<Module> results = searchResults();
        drawHeader(graphics, x, layout.y(), layout.columnWidth(), "Search",
                search.isEmpty() ? "" : Integer.toString(results.size()), false,
                () -> {
                }, mouseX, mouseY);
        int bodyTop = layout.y() + layout.headerHeight();
        int bodyBottom = layout.y() + layout.height() - 3;
        ui.fill(graphics, x, bodyTop, x + layout.columnWidth(), layout.y() + layout.height(),
                Theme.COLUMN);
        ui.fill(graphics, x + layout.columnWidth() - 1, bodyTop,
                x + layout.columnWidth(), layout.y() + layout.height(), Theme.LINE_SOFT);

        int fieldX1 = x + 5;
        int fieldY1 = bodyTop + 5;
        int fieldX2 = x + layout.columnWidth() - 5;
        int fieldY2 = fieldY1 + 18;
        boolean fieldHover = inside(mouseX, mouseY, fieldX1, fieldY1, fieldX2, fieldY2);
        ui.fill(graphics, fieldX1, fieldY1, fieldX2, fieldY2, Theme.withAlpha(0xFF000000, 95));
        ui.fill(graphics, fieldX1, fieldY2 - 1, fieldX2, fieldY2,
                searchFocused ? Theme.ACCENT : fieldHover ? Theme.ACCENT_DARK : Theme.LINE);
        String fieldText = search.isEmpty() ? "Search modules" : search;
        ui.text(graphics, ui.fit(fieldText, Math.max(4, fieldX2 - fieldX1 - 8)),
                fieldX1 + 4, fieldY1 + 5,
                search.isEmpty() ? Theme.TEXT_DIM : Theme.TEXT);
        if (searchFocused && (System.currentTimeMillis() / 500L) % 2L == 0L) {
            int caretX = Math.min(fieldX2 - 4, fieldX1 + 4 + ui.width(search));
            ui.fill(graphics, caretX, fieldY1 + 4, caretX + 1, fieldY2 - 4, Theme.ACCENT_LIGHT);
        }
        addHit(fieldX1, fieldY1, fieldX2, fieldY2, 0, () -> {
            searchFocused = true;
            detailsModule = null;
        });

        int listTop = fieldY2 + 5;
        if (search.isEmpty()) {
            ui.text(graphics, "Titles and", x + 6, listTop + 7, Theme.TEXT_DIM);
            ui.text(graphics, "settings", x + 6, listTop + 19, Theme.TEXT_DIM);
            ui.text(graphics, "Left click", x + 6, listTop + 43, Theme.TEXT_MUTED);
            ui.text(graphics, "toggles", x + 6, listTop + 55, Theme.TEXT_DIM);
            ui.text(graphics, "Right click", x + 6, listTop + 75, Theme.TEXT_MUTED);
            ui.text(graphics, "settings", x + 6, listTop + 87, Theme.TEXT_DIM);
            return;
        }

        int viewHeight = Math.max(1, bodyBottom - listTop);
        int contentHeight = results.size() * ROW_HEIGHT + 4;
        double maxScroll = Math.max(0.0, contentHeight - viewHeight);
        columnScroll[CATEGORIES.length] = clamp(columnScroll[CATEGORIES.length], 0.0, maxScroll);
        boolean clipped = ui.canScissor();
        if (clipped) {
            ui.scissor(graphics, x + 1, listTop, x + layout.columnWidth() - 2, bodyBottom);
        }
        int cursor = listTop + 2 - (int) Math.round(columnScroll[CATEGORIES.length]);
        for (Module module : results) {
            int rowBottom = cursor + ROW_HEIGHT;
            if (rowBottom >= listTop - 2 && cursor <= bodyBottom + 2) {
                if (clipped || (cursor >= listTop && rowBottom <= bodyBottom)) {
                    drawModuleRow(graphics, module, x + 1, cursor,
                            layout.columnWidth() - 3, mouseX, mouseY,
                            listTop, bodyBottom, false);
                }
            }
            cursor += ROW_HEIGHT;
        }
        if (clipped) {
            ui.unscissor(graphics);
        }
        if (results.isEmpty()) {
            ui.textCentered(graphics, "No matches", x + layout.columnWidth() / 2,
                    listTop + 10, Theme.TEXT_DIM);
        }
        if (maxScroll > 0.5) {
            scrollAreas.add(new ScrollArea(x + 2, listTop, x + layout.columnWidth() - 2,
                    bodyBottom, ScrollTarget.COLUMN, CATEGORIES.length, maxScroll));
            drawScrollbar(graphics, x + layout.columnWidth() - 4, listTop, bodyBottom,
                    columnScroll[CATEGORIES.length], maxScroll);
        }
    }

    private void drawHeader(Object graphics, int x, int y, int width, String title,
            String count, boolean collapsed, Runnable action, int mouseX, int mouseY) {
        boolean hover = inside(mouseX, mouseY, x, y, x + width, y + HEADER_HEIGHT);
        ui.gradient(graphics, x, y, x + width, y + HEADER_HEIGHT,
                hover ? Theme.HEADER_TOP : Theme.ACCENT_LIGHT, Theme.HEADER_BOTTOM);
        ui.fill(graphics, x, y, x + width, y + 1, Theme.withAlpha(0xFFFFFFFF, 45));
        ui.fill(graphics, x, y + HEADER_HEIGHT - 1, x + width, y + HEADER_HEIGHT,
                Theme.withAlpha(0xFF000000, 70));
        ui.text(graphics, ui.fit(title, Math.max(4, width - 24)), x + 6,
                y + (HEADER_HEIGHT - 8) / 2 + 1, Theme.TEXT);
        if (width >= 55) {
            ui.textRight(graphics, count, x + width - 6,
                    y + (HEADER_HEIGHT - 8) / 2 + 1, Theme.withAlpha(0xFFFFFFFF, 190));
        }
        if (collapsed) {
            ui.fill(graphics, x + width - 3, y, x + width, y + HEADER_HEIGHT,
                    Theme.withAlpha(0xFF000000, 55));
        }
        addHit(x, y, x + width, y + HEADER_HEIGHT, 0, action);
    }

    private void drawModuleRow(Object graphics, Module module, int x, int y, int width,
            int mouseX, int mouseY, int clipTop, int clipBottom, boolean showKey) {
        boolean hover = inside(mouseX, mouseY, x, y, x + width, y + ROW_HEIGHT);
        if (module.enabled) {
            ui.fill(graphics, x, y, x + width, y + ROW_HEIGHT, Theme.ROW_ACTIVE);
            ui.fill(graphics, x, y, x + 2, y + ROW_HEIGHT, Theme.ACCENT);
        } else if (hover) {
            ui.fill(graphics, x, y, x + width, y + ROW_HEIGHT, Theme.ROW_HOVER);
            ui.fill(graphics, x, y, x + 1, y + ROW_HEIGHT, Theme.withAlpha(Theme.ACCENT, 150));
        }
        int keyWidth = showKey && module.keybind != 0 ? ui.width(keyName(module.keybind)) : 0;
        String label = ui.fit(module.label(), Math.max(4, width - 12 - (keyWidth > 0 ? keyWidth + 5 : 0)));
        ui.text(graphics, label, x + 6, y + 4,
                module.enabled ? Theme.TEXT : hover ? Theme.TEXT_SOFT : Theme.TEXT_MUTED);
        if (keyWidth > 0) {
            ui.textRight(graphics, keyName(module.keybind), x + width - 5, y + 4,
                    Theme.withAlpha(Theme.ACCENT_LIGHT, 180));
        }
        addClippedHit(x, y, x + width, y + ROW_HEIGHT, 0,
                () -> toggleModule(module), clipTop, clipBottom);
        addClippedHit(x, y, x + width, y + ROW_HEIGHT, 1,
                () -> openDetails(module), clipTop, clipBottom);
    }

    private void drawFooter(Object graphics, Layout layout, int mouseX, int mouseY) {
        int x = layout.x();
        int y = layout.footerY();
        ui.text(graphics, "BALD AGENT", x, y, Theme.ACCENT_LIGHT);
        int cursor = x + ui.width("BALD AGENT") + 9;
        ui.text(graphics, "1.21.11", cursor, y, Theme.TEXT_DIM);
        cursor += ui.width("1.21.11") + 14;

        String profile = "PROFILE " + Bl.currentProfile().toUpperCase(Locale.ROOT);
        boolean profileHover = inside(mouseX, mouseY, cursor, y - 3,
                cursor + ui.width(profile) + 4, y + 12);
        ui.text(graphics, profile, cursor, y,
                profileHover ? Theme.TEXT : Theme.TEXT_SOFT);
        addHit(cursor, y - 3, cursor + ui.width(profile) + 4, y + 12, 0, () -> {
            Bl.cycleProfile();
            toast("Profile: " + Bl.currentProfile());
        });

        int right = layout.x() + layout.width();
        int closeWidth = ui.width("RSHIFT CLOSE");
        ui.textRight(graphics, "RSHIFT CLOSE", right, y, Theme.TEXT_DIM);
        int saveRight = right - closeWidth - 14;
        int saveWidth = ui.width("SAVE");
        boolean saveHover = inside(mouseX, mouseY, saveRight - saveWidth - 4, y - 3,
                saveRight + 4, y + 12);
        ui.textRight(graphics, "SAVE", saveRight, y,
                saveHover ? Theme.ACCENT_LIGHT : Theme.TEXT_MUTED);
        addHit(saveRight - saveWidth - 4, y - 3, saveRight + 4, y + 12, 0, () -> {
            Bl.saveConfiguration();
            toast("Profile saved: " + Bl.currentProfile());
        });
        int reloadRight = saveRight - saveWidth - 14;
        int reloadWidth = ui.width("RELOAD");
        boolean reloadHover = inside(mouseX, mouseY, reloadRight - reloadWidth - 4, y - 3,
                reloadRight + 4, y + 12);
        ui.textRight(graphics, "RELOAD", reloadRight, y,
                reloadHover ? Theme.ACCENT_LIGHT : Theme.TEXT_MUTED);
        addHit(reloadRight - reloadWidth - 4, y - 3, reloadRight + 4, y + 12, 0, () -> {
            Bl.reloadConfiguration();
            toast("Profile reloaded: " + Bl.currentProfile());
        });

        if (layout.width() >= 660) {
            ui.textCentered(graphics, "LEFT CLICK TOGGLE   |   RIGHT CLICK SETTINGS",
                    layout.x() + layout.width() / 2, y, Theme.TEXT_DIM);
        }
    }

    private void drawDetails(Object graphics, int screenWidth, int screenHeight,
            int mouseX, int mouseY) {
        Module module = detailsModule;
        if (module == null) {
            return;
        }
        int panelWidth = Math.min(380, screenWidth - 24);
        int panelHeight = Math.min(470, screenHeight - 24);
        int panelX = (screenWidth - panelWidth) / 2;
        int panelY = (screenHeight - panelHeight) / 2;
        int headerHeight = 22;

        ui.fill(graphics, 0, 0, screenWidth, screenHeight, Theme.MODAL_SCRIM);
        addHit(0, 0, screenWidth, screenHeight, -1, this::closeDetails);
        ui.fill(graphics, panelX - 4, panelY + 3, panelX + panelWidth + 4,
                panelY + panelHeight + 5, Theme.SHADOW);
        ui.fill(graphics, panelX, panelY, panelX + panelWidth, panelY + panelHeight,
                Theme.PANEL);
        ui.gradient(graphics, panelX, panelY, panelX + panelWidth, panelY + headerHeight,
                Theme.HEADER_TOP, Theme.HEADER_BOTTOM);
        ui.fill(graphics, panelX, panelY + headerHeight - 1, panelX + panelWidth,
                panelY + headerHeight, Theme.withAlpha(0xFF000000, 80));
        ui.text(graphics, ui.fit(module.label(), panelWidth - 40), panelX + 10,
                panelY + 7, Theme.TEXT);
        int closeX1 = panelX + panelWidth - 22;
        int closeX2 = panelX + panelWidth - 7;
        boolean closeHover = inside(mouseX, mouseY, closeX1, panelY + 4, closeX2, panelY + 18);
        ui.textCentered(graphics, "x", (closeX1 + closeX2) / 2, panelY + 7,
                closeHover ? Theme.TEXT : Theme.TEXT_SOFT);
        addHit(closeX1, panelY + 4, closeX2, panelY + 18, 0, this::closeDetails);
        // Swallow clicks on empty panel space so they do not close the window.
        addHit(panelX, panelY, panelX + panelWidth, panelY + panelHeight, -1, () -> {
        });

        int cursor = panelY + headerHeight + 7;
        ui.text(graphics, module.enabled ? "ENABLED" : "DISABLED", panelX + 12, cursor,
                module.enabled ? Theme.ACCENT_LIGHT : Theme.TEXT_MUTED);
        drawSwitch(graphics, panelX + panelWidth - 46, cursor - 2, module.enabled,
                mouseX, mouseY, () -> toggleModule(module));
        cursor += 22;
        String description = module.description.isEmpty()
                ? "No description." : module.description;
        ui.text(graphics, ui.fit(description, panelWidth - 24), panelX + 12, cursor,
                Theme.TEXT_MUTED);
        cursor += 18;

        ui.text(graphics, "KEYBIND", panelX + 12, cursor + 5, Theme.TEXT_MUTED);
        smallButton(graphics, panelX + panelWidth - 132, cursor,
                panelX + panelWidth - 12, cursor + 20,
                bindingModule == module ? "PRESS A KEY..." : keyName(module.keybind),
                bindingModule == module, mouseX, mouseY, () -> {
                    bindingModule = module;
                    bindingSetting = null;
                    searchFocused = false;
                });
        cursor += 28;
        ui.fill(graphics, panelX + 10, cursor, panelX + panelWidth - 10, cursor + 1,
                Theme.LINE_SOFT);
        cursor += 8;

        List<Setting> settings = visibleSettings(module);
        ui.text(graphics, "SETTINGS", panelX + 12, cursor, Theme.TEXT_SOFT);
        ui.textRight(graphics, settings.size() + " OPTIONS", panelX + panelWidth - 12,
                cursor, Theme.TEXT_DIM);
        cursor += 15;

        int contentTop = cursor;
        int contentBottom = panelY + panelHeight - 7;
        if (contentBottom <= contentTop + 8) {
            contentBottom = contentTop + 8;
        }
        double total = settingsHeight(settings);
        double maxScroll = Math.max(0.0, total - (contentBottom - contentTop));
        detailsScroll = clamp(detailsScroll, 0.0, maxScroll);
        boolean clipped = ui.canScissor();
        if (clipped) {
            ui.scissor(graphics, panelX + 2, contentTop,
                    panelX + panelWidth - 2, contentBottom);
        }
        int rowY = contentTop - (int) Math.round(detailsScroll);
        for (Setting setting : settings) {
            int rowHeight = settingHeight(setting);
            if (rowY + rowHeight >= contentTop - 2 && rowY <= contentBottom + 2) {
                if (clipped || (rowY >= contentTop && rowY + rowHeight <= contentBottom)) {
                    drawSetting(graphics, module, setting, panelX + 8, rowY,
                            panelWidth - 16, mouseX, mouseY, contentTop, contentBottom);
                }
            }
            rowY += rowHeight;
        }
        if (clipped) {
            ui.unscissor(graphics);
        }
        if (settings.isEmpty()) {
            ui.textCentered(graphics, "No settings", panelX + panelWidth / 2,
                    contentTop + 10, Theme.TEXT_DIM);
        }
        if (maxScroll > 0.5) {
            scrollAreas.add(new ScrollArea(panelX + 2, contentTop,
                    panelX + panelWidth - 2, contentBottom,
                    ScrollTarget.DETAILS, -1, maxScroll));
            drawScrollbar(graphics, panelX + panelWidth - 6, contentTop,
                    contentBottom, detailsScroll, maxScroll);
        }
    }

    private void drawSetting(Object graphics, Module module, Setting setting,
            int x, int y, int width, int mouseX, int mouseY,
            int clipTop, int clipBottom) {
        int height = settingHeight(setting);
        boolean hover = inside(mouseX, mouseY, x, y, x + width, y + height);
        ui.fill(graphics, x, y, x + width, y + height - 3,
                hover ? Theme.SETTING_HOVER : Theme.SETTING_BG);
        ui.fill(graphics, x, y, x + 2, y + height - 3,
                setting.type == Setting.Type.BOOL && setting.getBool()
                        ? Theme.ACCENT : Theme.LINE_SOFT);
        int labelX = x + 8;
        int labelY = y + 6;
        int right = x + width - 8;
        switch (setting.type) {
            case BOOL -> {
                ui.text(graphics, ui.fit(setting.name, width - 40), labelX, labelY,
                        Theme.TEXT_SOFT);
                int boxX = right - 12;
                float boxY = y + (height - 3 - 12) / 2.0f;
                ui.fill(graphics, boxX, (int) boxY, boxX + 12, (int) boxY + 12,
                        setting.getBool() ? Theme.ACCENT : Theme.withAlpha(0xFF000000, 100));
                if (setting.getBool()) {
                    ui.fill(graphics, boxX + 3, (int) boxY + 3, boxX + 9, (int) boxY + 9,
                            Theme.ACCENT_LIGHT);
                }
                addClippedHit(x, y, x + width, y + height - 3, 0, () -> {
                    setting.setBool(!setting.getBool());
                    Bl.saveConfiguration();
                }, clipTop, clipBottom);
            }
            case INT, DOUBLE -> {
                ui.text(graphics, ui.fit(setting.name, Math.max(4, width - 90)), labelX,
                        labelY, Theme.TEXT_SOFT);
                ui.textRight(graphics, numberText(setting), right, labelY, Theme.TEXT);
                int trackLeft = x + 8;
                int trackRight = x + width - 8;
                int trackY = y + height - 13;
                int thumbX = trackLeft + (int) Math.round(progress(setting) * (trackRight - trackLeft));
                ui.fill(graphics, trackLeft, trackY, trackRight, trackY + 2, Theme.LINE);
                ui.fill(graphics, trackLeft, trackY, thumbX, trackY + 2, Theme.ACCENT);
                ui.fill(graphics, thumbX - 1, trackY - 2, thumbX + 2, trackY + 4,
                        Theme.ACCENT_LIGHT);
                addClippedHit(trackLeft - 3, trackY - 4, trackRight + 3, trackY + 8, 0, () -> {
                    draggingSetting = setting;
                    draggingLeft = trackLeft;
                    draggingRight = trackRight;
                    updateSlider(setting, mouseX, trackLeft, trackRight);
                }, clipTop, clipBottom);
            }
            case ENUM -> {
                int arrowWidth = 16;
                int arrowGap = 4;
                int valueGap = 8;
                int valueWidth = Math.max(48, Math.min(96, width / 3));
                int nextLeft = right - arrowWidth;
                int previousLeft = nextLeft - arrowGap - arrowWidth;
                int valueRight = previousLeft - valueGap;
                ui.text(graphics, ui.fit(setting.name,
                        Math.max(4, valueRight - valueWidth - labelX - 6)), labelX,
                        labelY, Theme.TEXT_SOFT);
                smallButton(graphics, previousLeft, y + 4, previousLeft + arrowWidth, y + 21,
                        "<", false, mouseX, mouseY, () -> adjustEnum(setting, -1));
                smallButton(graphics, nextLeft, y + 4, nextLeft + arrowWidth, y + 21,
                        ">", false, mouseX, mouseY, () -> adjustEnum(setting, 1));
                ui.textRight(graphics, ui.fit(setting.getEnum(), valueWidth), valueRight,
                        labelY, Theme.TEXT);
            }
            case COLOR -> {
                ui.text(graphics, ui.fit(setting.name, width - 55), labelX, labelY,
                        Theme.TEXT_SOFT);
                int swatchRight = right;
                int swatchLeft = swatchRight - 14;
                ui.fill(graphics, swatchLeft, y + 5, swatchRight, y + 19, setting.getColor());
                ui.fill(graphics, swatchLeft, y + 5, swatchRight, y + 6, 0x90FFFFFF);
                addClippedHit(swatchLeft, y + 5, swatchRight, y + 19, 1,
                        () -> adjustColor(setting, -1), clipTop, clipBottom);
                addClippedHit(swatchLeft, y + 5, swatchRight, y + 19, 0,
                        () -> adjustColor(setting, 1), clipTop, clipBottom);
                int paletteY = y + 23;
                for (int index = 0; index < PALETTE.length; index++) {
                    int sx = labelX + index * 17;
                    int color = PALETTE[index];
                    ui.fill(graphics, sx, paletteY, sx + 12, paletteY + 12, color);
                    if ((setting.getColor() & 0xFFFFFF) == (color & 0xFFFFFF)) {
                        ui.fill(graphics, sx - 1, paletteY - 1, sx + 13, paletteY, Theme.TEXT);
                        ui.fill(graphics, sx - 1, paletteY + 12, sx + 13, paletteY + 13, Theme.TEXT);
                    }
                    addClippedHit(sx, paletteY, sx + 12, paletteY + 12, 0, () -> {
                        setting.setColor(color);
                        Bl.saveConfiguration();
                    }, clipTop, clipBottom);
                }
            }
            case KEY -> {
                ui.text(graphics, ui.fit(setting.name, width - 120), labelX, labelY,
                        Theme.TEXT_SOFT);
                smallButton(graphics, right - 96, y + 4, right, y + 21,
                        bindingSetting == setting ? "PRESS..." : keyName(setting.getKey()),
                        bindingSetting == setting, mouseX, mouseY, () -> {
                            bindingSetting = setting;
                            bindingModule = null;
                            searchFocused = false;
                        });
            }
        }
    }

    private void drawSwitch(Object graphics, int x, int y, boolean on, int mouseX,
            int mouseY, Runnable action) {
        int width = 34;
        int height = 14;
        boolean hover = inside(mouseX, mouseY, x, y, x + width, y + height);
        ui.fill(graphics, x, y, x + width, y + height,
                on ? (hover ? Theme.ACCENT_LIGHT : Theme.ACCENT)
                        : (hover ? Theme.SETTING_HOVER : Theme.withAlpha(0xFF000000, 80)));
        int knobX = on ? x + width - 12 : x + 2;
        ui.fill(graphics, knobX, y + 2, knobX + 10, y + height - 2,
                on ? Theme.TEXT : Theme.TEXT_DIM);
        addHit(x, y, x + width, y + height, -1, action);
    }

    private void smallButton(Object graphics, int x1, int y1, int x2, int y2,
            String label, boolean active, int mouseX, int mouseY, Runnable action) {
        boolean hover = inside(mouseX, mouseY, x1, y1, x2, y2);
        ui.fill(graphics, x1, y1, x2, y2,
                active ? Theme.withAlpha(Theme.ACCENT, hover ? 190 : 150)
                        : hover ? Theme.SETTING_HOVER : Theme.withAlpha(0xFF000000, 65));
        ui.fill(graphics, x1, y1, x2, y1 + 1,
                active ? Theme.ACCENT_LIGHT : Theme.LINE_SOFT);
        ui.textCentered(graphics, ui.fit(label, Math.max(4, x2 - x1 - 5)),
                (x1 + x2) / 2, y1 + (y2 - y1 - 8) / 2, Theme.TEXT_SOFT);
        addHit(x1, y1, x2, y2, 0, action);
    }

    private void drawScrollbar(Object graphics, int right, int top, int bottom,
            double scroll, double max) {
        if (max <= 0.5) {
            return;
        }
        int trackX = right - 2;
        ui.fill(graphics, trackX, top, trackX + 2, bottom, Theme.LINE_SOFT);
        double view = Math.max(1.0, bottom - top);
        int thumbHeight = Math.max(12, (int) Math.round(view * view / (view + max)));
        int thumbY = top + (int) Math.round((view - thumbHeight) * (scroll / max));
        ui.fill(graphics, trackX - 1, thumbY, trackX + 3, thumbY + thumbHeight,
                Theme.withAlpha(Theme.ACCENT_LIGHT, 210));
    }

    private void drawToast(Object graphics, Layout layout) {
        long remaining = toastUntil - System.currentTimeMillis();
        if (remaining <= 0 || toast.isEmpty()) {
            return;
        }
        int alpha = remaining < 260 ? (int) (255 * remaining / 260) : 255;
        int width = Math.max(40, Math.min(layout.width() - 40, ui.width(toast) + 24));
        int x = layout.x() + (layout.width() - width) / 2;
        int y = layout.footerY() - 26;
        ui.fill(graphics, x, y, x + width, y + 20, Theme.withAlpha(Theme.TOAST, alpha));
        ui.fill(graphics, x, y, x + 3, y + 20, Theme.withAlpha(Theme.ACCENT, alpha));
        ui.fill(graphics, x, y + 19, x + width, y + 20, Theme.withAlpha(Theme.LINE, alpha));
        ui.textCentered(graphics, ui.fit(toast, width - 14), x + width / 2, y + 6,
                Theme.withAlpha(Theme.TEXT, alpha));
    }

    private List<Category> categories() {
        return List.of(CATEGORIES);
    }

    private List<Module> categoryModules(Category category) {
        List<Module> result = new ArrayList<>();
        String query = search.trim().toLowerCase(Locale.ROOT);
        for (Module module : Bl.modules()) {
            if (module.category != category) {
                continue;
            }
            if (!query.isEmpty() && !matches(module, query)) {
                continue;
            }
            result.add(module);
        }
        result.sort(Comparator.comparing(module -> module.label().toLowerCase(Locale.ROOT)));
        return result;
    }

    private List<Module> searchResults() {
        List<Module> result = new ArrayList<>();
        String query = search.trim().toLowerCase(Locale.ROOT);
        if (query.isEmpty()) {
            return result;
        }
        for (Module module : Bl.modules()) {
            if (matches(module, query)) {
                result.add(module);
            }
        }
        result.sort(Comparator.comparing(module -> module.label().toLowerCase(Locale.ROOT)));
        return result;
    }

    private boolean matches(Module module, String query) {
        if (module.label().toLowerCase(Locale.ROOT).contains(query)
                || module.name.toLowerCase(Locale.ROOT).contains(query)
                || module.description.toLowerCase(Locale.ROOT).contains(query)) {
            return true;
        }
        for (Setting setting : module.settings) {
            if (setting.name.toLowerCase(Locale.ROOT).contains(query)) {
                return true;
            }
        }
        return false;
    }

    private List<Setting> visibleSettings(Module module) {
        List<Setting> result = new ArrayList<>();
        for (Setting setting : module.settings) {
            if (setting.visible()) {
                result.add(setting);
            }
        }
        return result;
    }

    private double settingsHeight(List<Setting> settings) {
        double total = 0.0;
        for (Setting setting : settings) {
            total += settingHeight(setting);
        }
        return total;
    }

    private int settingHeight(Setting setting) {
        return switch (setting.type) {
            case BOOL -> 25;
            case INT, DOUBLE -> 35;
            case ENUM, KEY -> 27;
            case COLOR -> 42;
        };
    }

    private void toggleModule(Module module) {
        module.toggle();
        Bl.saveConfiguration();
        toast(module.label() + (module.enabled ? " enabled" : " disabled"));
    }

    private void openDetails(Module module) {
        detailsModule = module;
        detailsScroll = 0.0;
        bindingModule = null;
        bindingSetting = null;
        searchFocused = false;
    }

    private void closeDetails() {
        detailsModule = null;
        detailsScroll = 0.0;
        draggingSetting = null;
        bindingModule = null;
        bindingSetting = null;
    }

    private void resetState() {
        search = "";
        searchFocused = false;
        detailsModule = null;
        detailsScroll = 0.0;
        draggingSetting = null;
        bindingModule = null;
        bindingSetting = null;
        toast = "";
        toastUntil = 0L;
        uiFailureReported = false;
        for (int index = 0; index < columnScroll.length; index++) {
            columnScroll[index] = 0.0;
        }
        for (int index = 0; index < columnCollapsed.length; index++) {
            columnCollapsed[index] = false;
        }
    }

    private void handleBindingKey(int key) {
        if (key == 256) {
            bindingModule = null;
            bindingSetting = null;
            return;
        }
        int value = key == 259 || key == 261 ? 0 : key;
        if (bindingSetting != null) {
            bindingSetting.setKey(value);
        } else if (bindingModule != null) {
            bindingModule.keybind = value;
        }
        bindingModule = null;
        bindingSetting = null;
        Bl.saveConfiguration();
        toast("Keybind updated");
    }

    private boolean handleSearchKey(int key) {
        if (key == 256) {
            search = "";
            searchFocused = false;
            return true;
        }
        if (key == 257 || key == 335) {
            searchFocused = false;
            return true;
        }
        if (key == 259) {
            if (!search.isEmpty()) {
                search = search.substring(0, search.length() - 1);
            }
            return true;
        }
        char character = typeCharacter(key);
        if (character != 0 && search.length() < 24) {
            search += Character.toLowerCase(character);
        }
        return true;
    }

    private char typeCharacter(int key) {
        if (key >= 65 && key <= 90) {
            return (char) key;
        }
        if (key >= 48 && key <= 57) {
            return (char) key;
        }
        if (key >= 320 && key <= 329) {
            return (char) ('0' + key - 320);
        }
        return switch (key) {
            case 32 -> ' ';
            case 45, 333 -> '-';
            case 46, 330 -> '.';
            default -> 0;
        };
    }

    private void adjustEnum(Setting setting, int direction) {
        List<String> options = setting.getOptions();
        if (options == null || options.isEmpty()) {
            return;
        }
        int current = options.indexOf(setting.getEnum());
        if (current < 0) {
            current = 0;
        }
        setting.setEnum(options.get((current + direction + options.size()) % options.size()));
        Bl.saveConfiguration();
    }

    private void adjustColor(Setting setting, int direction) {
        int current = 0;
        for (int index = 0; index < PALETTE.length; index++) {
            if ((PALETTE[index] & 0xFFFFFF) == (setting.getColor() & 0xFFFFFF)) {
                current = index;
                break;
            }
        }
        setting.setColor(PALETTE[(current + direction + PALETTE.length) % PALETTE.length]);
        Bl.saveConfiguration();
    }

    private String numberText(Setting setting) {
        if (setting.type == Setting.Type.INT) {
            return Integer.toString(setting.getInt());
        }
        return String.format(Locale.ROOT, "%.2f", setting.getDouble());
    }

    private double progress(Setting setting) {
        if (setting.type == Setting.Type.INT) {
            int range = setting.getMax() - setting.getMin();
            return range == 0 ? 0.0 : (double) (setting.getInt() - setting.getMin()) / range;
        }
        double range = setting.getDMax() - setting.getDMin();
        return range == 0.0 ? 0.0 : (setting.getDouble() - setting.getDMin()) / range;
    }

    private void updateSlider(Setting setting, double mouseX, int left, int right) {
        double value = clamp((mouseX - left) / Math.max(1.0, right - left), 0.0, 1.0);
        if (setting.type == Setting.Type.INT) {
            int range = setting.getMax() - setting.getMin();
            setting.setInt(setting.getMin() + (int) Math.round(value * range));
        } else {
            setting.setDouble(setting.getDMin() + value * (setting.getDMax() - setting.getDMin()));
        }
    }

    private String categoryName(Category category) {
        String name = category.name().toLowerCase(Locale.ROOT);
        return Character.toUpperCase(name.charAt(0)) + name.substring(1);
    }

    private String keyName(int key) {
        if (key == 0) {
            return "NONE";
        }
        if (key >= 65 && key <= 90) {
            return String.valueOf((char) key);
        }
        if (key >= 48 && key <= 57) {
            return String.valueOf((char) key);
        }
        if (key >= 320 && key <= 329) {
            return "NUM " + (key - 320);
        }
        if (key >= 290 && key <= 299) {
            return "F" + (key - 289);
        }
        return switch (key) {
            case 32 -> "SPACE";
            case 256 -> "ESC";
            case 257 -> "ENTER";
            case 258 -> "TAB";
            case 259 -> "BACKSPACE";
            case 260 -> "INSERT";
            case 261 -> "DELETE";
            case 262 -> "RIGHT";
            case 263 -> "LEFT";
            case 264 -> "DOWN";
            case 265 -> "UP";
            case 266 -> "PAGE UP";
            case 267 -> "PAGE DOWN";
            case 268 -> "HOME";
            case 269 -> "END";
            case 340 -> "LSHIFT";
            case 341 -> "LCTRL";
            case 342 -> "LALT";
            case 343 -> "SUPER";
            case 344 -> "RSHIFT";
            case 345 -> "RCTRL";
            case 346 -> "RALT";
            default -> "KEY " + key;
        };
    }

    private void toast(String message) {
        toast = message;
        toastUntil = System.currentTimeMillis() + 1500L;
    }

    private void addHit(int x1, int y1, int x2, int y2, int button, Runnable action) {
        if (x2 <= x1 || y2 <= y1) {
            return;
        }
        hits.add(new Hit(x1, y1, x2, y2, button, action));
    }

    private void addClippedHit(int x1, int y1, int x2, int y2, int button,
            Runnable action, int clipTop, int clipBottom) {
        int top = Math.max(y1, clipTop);
        int bottom = Math.min(y2, clipBottom);
        if (bottom > top) {
            addHit(x1, top, x2, bottom, button, action);
        }
    }

    private boolean inside(double mouseX, double mouseY, int x1, int y1, int x2, int y2) {
        return mouseX >= x1 && mouseX < x2 && mouseY >= y1 && mouseY < y2;
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private void reportFailure(String action, Throwable error) {
        if (!uiFailureReported) {
            uiFailureReported = true;
            System.err.println("[Bald Agent] Could not " + action + ": " + error);
            error.printStackTrace(System.err);
        }
    }

    private void initialize(ClassLoader gameLoader, int runtimeNamespace) throws Exception {
        namespace = runtimeNamespace;
        RuntimeMappings.configure(runtimeNamespace, gameLoader);
        if (minecraft != null) {
            return;
        }
        String minecraftInternal = RuntimeMappings.className("net/minecraft/client/Minecraft");
        String screenInternal = RuntimeMappings.className("net/minecraft/client/gui/screens/Screen");
        Class<?> minecraftType = Class.forName(minecraftInternal.replace('/', '.'), true, gameLoader);
        screenType = Class.forName(screenInternal.replace('/', '.'), true, gameLoader);
        minecraft = findSingleton(minecraftType).invoke(null);
        setScreen = findSetScreen(minecraftType, screenType);
        currentScreen = findFieldOfType(minecraftType, screenType);
        widthField = dimensionField(screenType, "width", 0);
        heightField = dimensionField(screenType, "height", 1);
    }

    private Object currentScreen() {
        if (minecraft == null || currentScreen == null) {
            return null;
        }
        try {
            return currentScreen.get(minecraft);
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("Cannot read the active Minecraft screen", error);
        }
    }

    private void show(Object screen) throws ReflectiveOperationException {
        setScreen.invoke(minecraft, screen);
    }

    private void clearMenu() {
        menu = null;
        parent = null;
        hits.clear();
        scrollAreas.clear();
        draggingSetting = null;
        bindingModule = null;
        bindingSetting = null;
        detailsModule = null;
        searchFocused = false;
    }

    private Class<?> createMenuType() throws Exception {
        Constructor<?> screenConstructor = findScreenConstructor(screenType);
        Class<?> componentType = screenConstructor.getParameterTypes()[0];
        Method literal = findLiteral(componentType);
        renderMethod = findScreenMethod(screenType, "render",
                method -> method.getReturnType() == void.class && method.getParameterCount() == 4
                        && method.getParameterTypes()[1] == int.class
                        && method.getParameterTypes()[2] == int.class
                        && method.getParameterTypes()[3] == float.class);
        Class<?> graphicsType = renderMethod.getParameterTypes()[0];
        fontField = findFontField(screenType, graphicsType);
        Method mouseClicked = findScreenMethod(screenType, "mouseClicked",
                method -> method.getReturnType() == boolean.class && method.getParameterCount() == 2
                        && method.getParameterTypes()[1] == boolean.class);
        Class<?> eventType = mouseClicked.getParameterTypes()[0];
        Method mouseDragged = findScreenMethod(screenType, "mouseDragged",
                method -> method.getReturnType() == boolean.class && method.getParameterCount() == 3
                        && method.getParameterTypes()[0] == eventType
                        && method.getParameterTypes()[1] == double.class
                        && method.getParameterTypes()[2] == double.class);
        Method mouseReleased = findScreenMethod(screenType, "mouseReleased",
                method -> method.getReturnType() == boolean.class && method.getParameterCount() == 1
                        && method.getParameterTypes()[0] == eventType);
        Method mouseScrolled = findScreenMethod(screenType, "mouseScrolled",
                method -> method.getReturnType() == boolean.class && method.getParameterCount() == 4
                        && method.getParameterTypes()[0] == double.class
                        && method.getParameterTypes()[1] == double.class
                        && method.getParameterTypes()[2] == double.class
                        && method.getParameterTypes()[3] == double.class);
        Method keyPressed = findScreenMethod(screenType, "keyPressed",
                method -> method.getReturnType() == boolean.class && method.getParameterCount() == 1
                        && !method.getParameterTypes()[0].isPrimitive());
        Method closeMethod = findClose(screenType);
        mouseXMethod = findAccessor(eventType, "x", double.class);
        mouseYMethod = findAccessor(eventType, "y", double.class);
        mouseButtonMethod = findAccessor(eventType, "button", int.class);
        keyCodeMethod = findAccessor(keyPressed.getParameterTypes()[0], "key", int.class);

        String screenInternal = Type.getInternalName(screenType);
        int separator = screenInternal.lastIndexOf('/');
        String menuInternal = (separator < 0 ? "" : screenInternal.substring(0, separator + 1))
                + "BaldAgentScreen$" + Integer.toHexString(System.identityHashCode(this));
        String componentDescriptor = Type.getDescriptor(componentType);
        ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_FRAMES | ClassWriter.COMPUTE_MAXS) {
            @Override
            protected String getCommonSuperClass(String type1, String type2) {
                try {
                    Class<?> first = Class.forName(type1.replace('/', '.'), false, screenType.getClassLoader());
                    Class<?> second = Class.forName(type2.replace('/', '.'), false, screenType.getClassLoader());
                    if (first.isAssignableFrom(second)) {
                        return type1;
                    }
                    if (second.isAssignableFrom(first)) {
                        return type2;
                    }
                } catch (Throwable ignored) {
                    // Fall back to Object; the generated methods only use simple values.
                }
                return "java/lang/Object";
            }
        };
        writer.visit(Opcodes.V21, Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SUPER,
                menuInternal, null, screenInternal, null);
        addConstructor(writer, menuInternal, screenInternal, componentDescriptor, literal);
        addRender(writer, screenInternal, renderMethod);
        addMouseClicked(writer, mouseClicked);
        addMouseDragged(writer, mouseDragged);
        addMouseReleased(writer, mouseReleased);
        addMouseScrolled(writer, mouseScrolled);
        addKeyPressed(writer, keyPressed);
        addClose(writer, closeMethod);
        writer.visitEnd();

        MethodHandles.Lookup lookup = MethodHandles.privateLookupIn(screenType, MethodHandles.lookup());
        return lookup.defineClass(writer.toByteArray());
    }

    private static void addConstructor(ClassWriter writer, String menuInternal, String screenInternal,
            String componentDescriptor, Method literal) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitLdcInsn("Bald Agent Modules");
        method.visitMethodInsn(Opcodes.INVOKESTATIC, Type.getInternalName(literal.getDeclaringClass()),
                literal.getName(), Type.getMethodDescriptor(literal),
                literal.getDeclaringClass().isInterface());
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, "<init>",
                "(" + componentDescriptor + ")V", false);
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addRender(ClassWriter writer, String screenInternal, Method render) {
        String descriptor = Type.getMethodDescriptor(render);
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, render.getName(), descriptor, null, null);
        method.visitCode();
        // If the overlay can host the GUI, it is drawn there (and the vanilla
        // background pass is skipped); otherwise fall back to the framebuffer.
        var framebuffer = new org.objectweb.asm.Label();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitVarInsn(Opcodes.ILOAD, 2);
        method.visitVarInsn(Opcodes.ILOAD, 3);
        method.visitVarInsn(Opcodes.FLOAD, 4);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "renderMenuOverlay",
                "(Ljava/lang/Object;Ljava/lang/Object;IIF)Z", false);
        method.visitJumpInsn(Opcodes.IFEQ, framebuffer);
        method.visitInsn(Opcodes.RETURN);
        method.visitLabel(framebuffer);
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitVarInsn(Opcodes.ILOAD, 2);
        method.visitVarInsn(Opcodes.ILOAD, 3);
        method.visitVarInsn(Opcodes.FLOAD, 4);
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, render.getName(), descriptor, false);
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitVarInsn(Opcodes.ILOAD, 2);
        method.visitVarInsn(Opcodes.ILOAD, 3);
        method.visitVarInsn(Opcodes.FLOAD, 4);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "renderMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;IIF)V", false);
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseClicked(ClassWriter writer, Method mouseClicked) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseClicked.getName(),
                Type.getMethodDescriptor(mouseClicked), null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "clickMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)V", false);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseDragged(ClassWriter writer, Method mouseDragged) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseDragged.getName(),
                Type.getMethodDescriptor(mouseDragged), null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "dragMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)Z", false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseReleased(ClassWriter writer, Method mouseReleased) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseReleased.getName(),
                Type.getMethodDescriptor(mouseReleased), null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "releaseMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)Z", false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseScrolled(ClassWriter writer, Method mouseScrolled) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseScrolled.getName(),
                Type.getMethodDescriptor(mouseScrolled), null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.DLOAD, 1);
        method.visitVarInsn(Opcodes.DLOAD, 3);
        method.visitVarInsn(Opcodes.DLOAD, 5);
        method.visitVarInsn(Opcodes.DLOAD, 7);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "scrollMenu",
                "(Ljava/lang/Object;DDDD)Z", false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addKeyPressed(ClassWriter writer, Method keyPressed) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, keyPressed.getName(),
                Type.getMethodDescriptor(keyPressed), null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "keyMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)Z", false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addClose(ClassWriter writer, Method close) {
        var method = writer.visitMethod(Opcodes.ACC_PUBLIC, close.getName(),
                Type.getMethodDescriptor(close), null, null);
        method.visitCode();
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "bl/Bl", "closeMenu", "()V", false);
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static Method findScreenMethod(Class<?> type, String named, Predicate<Method> filter)
            throws NoSuchMethodException {
        List<String> names = mappedNames(type, named);
        for (Method method : methods(type)) {
            if (names.contains(method.getName()) && filter.test(method)) {
                method.setAccessible(true);
                return method;
            }
        }
        for (Method method : methods(type)) {
            if (method.getName().equals(named) && filter.test(method)) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(type.getName() + "#" + named);
    }

    private static List<String> mappedNames(Class<?> type, String named) {
        Set<String> names = new LinkedHashSet<>();
        collectNames(type, named, names, new HashSet<>());
        names.add(named);
        return new ArrayList<>(names);
    }

    private static void collectNames(Class<?> type, String named, Set<String> names, Set<Class<?>> seen) {
        if (type == null || !seen.add(type)) {
            return;
        }
        names.addAll(RuntimeMappings.memberNames(type.getName(), named, false));
        collectNames(type.getSuperclass(), named, names, seen);
        for (Class<?> parent : type.getInterfaces()) {
            collectNames(parent, named, names, seen);
        }
    }

    private static List<Method> methods(Class<?> type) {
        List<Method> methods = new ArrayList<>();
        for (Method method : type.getMethods()) {
            methods.add(method);
        }
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Method method : current.getDeclaredMethods()) {
                if (!methods.contains(method)) {
                    methods.add(method);
                }
            }
        }
        return methods;
    }

    private static Method findClose(Class<?> type) throws NoSuchMethodException {
        for (String named : List.of("close", "onClose")) {
            List<String> names = mappedNames(type, named);
            for (Method method : methods(type)) {
                if (method.getReturnType() == void.class && method.getParameterCount() == 0
                        && (names.contains(method.getName()) || method.getName().equals(named))) {
                    method.setAccessible(true);
                    return method;
                }
            }
        }
        throw new NoSuchMethodException(type.getName() + "#close");
    }

    private static Method findAccessor(Class<?> type, String named, Class<?> returnType)
            throws NoSuchMethodException {
        List<String> names = mappedNames(type, named);
        Method fallback = null;
        for (Method method : type.getMethods()) {
            if (method.getParameterCount() != 0 || method.getReturnType() != returnType) {
                continue;
            }
            if (names.contains(method.getName())) {
                method.setAccessible(true);
                return method;
            }
            if (fallback == null) {
                fallback = method;
            }
        }
        if (fallback != null) {
            fallback.setAccessible(true);
            return fallback;
        }
        throw new NoSuchMethodException(type.getName() + "#" + named);
    }

    private static Method findLiteral(Class<?> componentType) throws NoSuchMethodException {
        List<String> names = mappedNames(componentType, "literal");
        for (Method method : methods(componentType)) {
            if (Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 1
                    && method.getParameterTypes()[0] == String.class
                    && componentType.isAssignableFrom(method.getReturnType())
                    && names.contains(method.getName())) {
                method.setAccessible(true);
                return method;
            }
        }
        for (Method method : methods(componentType)) {
            if (Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 1
                    && method.getParameterTypes()[0] == String.class
                    && componentType.isAssignableFrom(method.getReturnType())) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(componentType.getName() + "#literal");
    }

    private static Field findFontField(Class<?> screenType, Class<?> graphicsType)
            throws NoSuchFieldException {
        for (Field field : allFields(screenType)) {
            if (Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            for (Method method : graphicsType.getMethods()) {
                Class<?>[] parameters = method.getParameterTypes();
                if (method.getReturnType() == void.class && parameters.length >= 5
                        && parameters[0] == field.getType() && parameters[1] == String.class
                        && parameters[2] == int.class && parameters[3] == int.class
                        && parameters[4] == int.class) {
                    field.setAccessible(true);
                    return field;
                }
            }
        }
        throw new NoSuchFieldException("Screen text renderer field");
    }

    private static List<Field> allFields(Class<?> type) {
        List<Field> fields = new ArrayList<>();
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                fields.add(field);
            }
        }
        return fields;
    }

    private static Method findSingleton(Class<?> type) throws NoSuchMethodException {
        for (Method method : methods(type)) {
            if (Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 0
                    && method.getReturnType() == type) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(type.getName() + " singleton");
    }

    private static Method findSetScreen(Class<?> minecraftType, Class<?> screenType)
            throws NoSuchMethodException {
        for (Method method : methods(minecraftType)) {
            if (!Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 1
                    && method.getParameterTypes()[0] == screenType
                    && method.getReturnType() == void.class) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(minecraftType.getName() + "#setScreen");
    }

    private static Field findFieldOfType(Class<?> type, Class<?> fieldType) throws NoSuchFieldException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                if (field.getType() == fieldType && !Modifier.isStatic(field.getModifiers())) {
                    field.setAccessible(true);
                    return field;
                }
            }
        }
        throw new NoSuchFieldException(type.getName() + " screen field");
    }

    private static Constructor<?> findScreenConstructor(Class<?> screenType) throws NoSuchMethodException {
        for (Constructor<?> constructor : screenType.getDeclaredConstructors()) {
            if (constructor.getParameterCount() == 1) {
                constructor.setAccessible(true);
                return constructor;
            }
        }
        throw new NoSuchMethodException(screenType.getName() + "(Component)");
    }

    private static Field dimensionField(Class<?> screenType, String named, int index)
            throws NoSuchFieldException {
        List<String> candidates = new ArrayList<>(
                RuntimeMappings.memberNames(screenType.getName(), named, true));
        candidates.add(named);
        candidates.add(index == 0 ? "o" : "p");
        candidates.add(index == 0 ? "field_22789" : "field_22790");
        for (String candidate : candidates) {
            Field field = findFieldDeep(screenType, candidate);
            if (field != null && field.getType() == int.class
                    && !Modifier.isStatic(field.getModifiers())) {
                field.setAccessible(true);
                return field;
            }
        }
        List<Field> integers = new ArrayList<>();
        for (Field field : allFields(screenType)) {
            if (field.getType() == int.class && !Modifier.isStatic(field.getModifiers())) {
                integers.add(field);
            }
        }
        if (integers.size() > index) {
            Field field = integers.get(index);
            field.setAccessible(true);
            return field;
        }
        throw new NoSuchFieldException(screenType.getName() + "#" + named);
    }

    private static Field findFieldDeep(Class<?> type, String name) {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            try {
                return current.getDeclaredField(name);
            } catch (NoSuchFieldException ignored) {
                // Continue through the hierarchy.
            }
        }
        return null;
    }
}
