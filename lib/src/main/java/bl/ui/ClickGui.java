package bl.ui;

import java.lang.invoke.MethodHandles;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

import bl.Bl;
import bl.agent.Descriptors;
import bl.mc.RuntimeMappings;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class ClickGui {

    private static final String BL_OWNER = "bl/Bl";
    private static final int PANEL_WIDTH = 1080;
    private static final int PANEL_HEIGHT = 620;
    private static final int MIN_SIDEBAR_WIDTH = 160;
    private static final int MAX_SIDEBAR_WIDTH = 320;
    private static final int ROW_HEIGHT = 41;
    private static final int SETTING_ROW_HEIGHT = 48;
    private static final int SETTING_ROW_TOP = 213;
    private static final int SETTING_BOTTOM_PADDING = 16;

    private Object minecraft;
    private Object parent;
    private Object menu;
    private Method setScreen;
    private Field currentScreen;
    private Class<?> screenType;
    private Class<?> menuType;
    private int namespace;
    private Method fillMethod;
    private Method drawStringMethod;
    private Method fontWidthMethod;
    private Method mouseXMethod;
    private Method mouseYMethod;
    private Method mouseButtonMethod;
    private Field fontField;
    private Field widthField;
    private Field heightField;
    private int selectedCategory;
    private int page;
    private int settingPage;
    private Module selectedModule;
    private Module bindingModule;
    private Setting bindingSetting;
    private Setting draggingSetting;
    private Setting editingNumberSetting;
    private String numberInput = "";
    private boolean numberInputDirty;
    private boolean numberInputInvalid;
    private Method keyCodeMethod;
    private boolean uiFailureReported;

    public void toggle(Object source, int runtimeNamespace) {
        try {
            if (source == null || runtimeNamespace < 0 || runtimeNamespace > 1) {
                throw new IllegalStateException("Missing Minecraft keyboard context");
            }
            if (menu != null && currentScreen() == menu) {
                show(parent);
                clearMenu();
                return;
            }
            initialize(source.getClass().getClassLoader(), runtimeNamespace);
            parent = currentScreen();
            if (menuType == null) {
                menuType = createMenuType();
            }
            menu = menuType.getDeclaredConstructor().newInstance();
            show(menu);
        } catch (Throwable error) {
            clearMenu();
            System.err.println("[Bald Agent] Could not open module menu: " + error);
            error.printStackTrace(System.err);
        }
    }

    public boolean isOpen() {
        return menu != null && currentScreen() == menu;
    }

    public void tick() {
    }

    public void overlayMessage() {
    }

    public void close() {
        if (menu != null) {
            try {
                show(parent);
            } catch (Throwable error) {
                System.err.println("[Bald Agent] Could not close module menu: " + error);
                error.printStackTrace(System.err);
            } finally {
                clearMenu();
            }
        }
    }

    private void initialize(ClassLoader gameLoader, int runtimeNamespace) throws Exception {
        if (minecraft != null) {
            namespace = runtimeNamespace;
            return;
        }
        namespace = runtimeNamespace;
        String minecraftName = Descriptors.CLASS_MINECRAFT[namespace].replace('/', '.');
        Class<?> minecraftType = Class.forName(minecraftName, true, gameLoader);
        String screenName = descriptorClass(Descriptors.MINECRAFT_SET_SCREEN[0][namespace == 0 ? 2 : 3]);
        screenType = Class.forName(screenName.replace('/', '.'), true, gameLoader);
        Method singleton = findSingleton(minecraftType);
        minecraft = singleton.invoke(null);
        setScreen = findSetScreen(minecraftType, screenType);
        currentScreen = findScreenField(minecraftType, screenType);
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

    private void show(Object screen) throws Exception {
        setScreen.invoke(minecraft, screen);
    }

    private void clearMenu() {
        menu = null;
        parent = null;
        draggingSetting = null;
        editingNumberSetting = null;
        numberInputInvalid = false;
    }

    public void render(Object screen, Object graphics, int mouseX, int mouseY, float delta) {
        if (uiFailureReported) {
            return;
        }
        try {
            int screenWidth = widthField.getInt(screen);
            int screenHeight = heightField.getInt(screen);
            int[] layout = layout(screenWidth, screenHeight);
            int panelX = layout[0];
            int panelY = layout[1];
            int panelWidth = layout[2];
            int panelHeight = layout[3];
            int sidebarRight = layout[4];
            int listX = layout[5];
            int listRight = layout[6];
            int detailsX = layout[7];
            int detailsRight = layout[8];
            int listTop = layout[9];
            int listBottom = layout[10];
            int rowsPerPage = layout[11];
            List<Category> categories = availableCategories();
            selectedCategory = Math.min(selectedCategory, categories.size() - 1);
            if (selectedModule != null && !Bl.modules().contains(selectedModule)) {
                selectedModule = null;
            }

            fill(graphics, 0, 0, screenWidth, screenHeight, 0xB8000000);
            fill(graphics, panelX, panelY, panelX + panelWidth, panelY + panelHeight, 0xFF0C1118);
            fill(graphics, panelX, panelY, panelX + panelWidth, panelY + 72, 0xFF151D27);
            fill(graphics, panelX, panelY + 72, sidebarRight, panelY + panelHeight, 0xFF111820);
            fill(graphics, sidebarRight, panelY + 72, listRight + 10, panelY + panelHeight, 0xFF0D131A);
            fill(graphics, listRight + 10, panelY + 72, panelX + panelWidth, panelY + panelHeight, 0xFF101720);
            fill(graphics, panelX, panelY + 70, panelX + panelWidth, panelY + 72, 0xFF3DD6B0);
            fill(graphics, sidebarRight - 1, panelY + 72, sidebarRight, panelY + panelHeight, 0xFF27313D);
            fill(graphics, listRight + 9, panelY + 72, listRight + 10, panelY + panelHeight, 0xFF27313D);

            draw(graphics, "BALD AGENT", panelX + 24, panelY + 13, 0xFFFFFFFF);
            draw(graphics, "MODULE CONTROL CENTER", panelX + 24, panelY + 37, 0xFF91A0B0);
            draw(graphics, "RIGHT SHIFT  ·  CLOSE", panelX + 24, panelY + 54, 0xFF657586);
            drawButton(graphics, panelX + panelWidth - 344, panelY + 23, panelX + panelWidth - 198,
                    panelY + 49, profileLabel(), mouseX, mouseY, 0xFF293542);
            drawButton(graphics, panelX + panelWidth - 192, panelY + 23, panelX + panelWidth - 144,
                    panelY + 49, "NEW", mouseX, mouseY, 0xFF293542);
            drawButton(graphics, panelX + panelWidth - 136, panelY + 23, panelX + panelWidth - 78,
                    panelY + 49, "SAVE", mouseX, mouseY, 0xFF245E52);
            drawButton(graphics, panelX + panelWidth - 70, panelY + 23, panelX + panelWidth - 12,
                    panelY + 49, "LOAD", mouseX, mouseY, 0xFF293542);

            draw(graphics, "CATEGORIES", panelX + 22, panelY + 84, 0xFF718093);
            for (int index = 0; index < categories.size(); index++) {
                int tabTop = panelY + 96 + index * 39;
                boolean selected = index == selectedCategory;
                boolean hovered = mouseX >= panelX + 10 && mouseX < sidebarRight - 10
                        && mouseY >= tabTop && mouseY < tabTop + 30;
                if (selected || hovered) {
                    fill(graphics, panelX + 10, tabTop, sidebarRight - 10, tabTop + 31,
                            selected ? 0xFF1C3434 : 0xFF19222C);
                }
                if (selected) {
                    fill(graphics, panelX + 10, tabTop + 5, panelX + 13, tabTop + 26, 0xFF3DD6B0);
                }
                draw(graphics, categoryName(categories.get(index)), panelX + 22, tabTop + 10,
                        selected ? 0xFFFFFFFF : 0xFFB4C0CC);
                draw(graphics, Integer.toString(countModules(categories.get(index))),
                        sidebarRight - 27, tabTop + 10, selected ? 0xFF8FEAD3 : 0xFF718093);
            }

            List<Module> visible = visibleModules();
            int maxPage = Math.max(0, (visible.size() - 1) / rowsPerPage);
            page = Math.min(page, maxPage);
            int start = page * rowsPerPage;
            int end = Math.min(visible.size(), start + rowsPerPage);
            draw(graphics, categoryName(categories.get(selectedCategory)).toUpperCase(),
                    listX, panelY + 87, 0xFFFFFFFF);
            draw(graphics, visible.size() + " MODULES", listX, panelY + 104, 0xFF718093);
            draw(graphics, enabledModuleCount(visible) + " ACTIVE",
                    listRight - 64, panelY + 93, 0xFF5CC9A8);
            for (int index = start; index < end; index++) {
                Module module = visible.get(index);
                int row = index - start;
                int rowTop = listTop + row * ROW_HEIGHT;
                boolean selected = selectedModule == module;
                boolean hovered = mouseX >= listX && mouseX < listRight
                        && mouseY >= rowTop && mouseY < rowTop + ROW_HEIGHT - 4;
                fill(graphics, listX, rowTop, listRight, rowTop + ROW_HEIGHT - 4,
                        selected ? 0xFF1D2A35 : hovered ? 0xFF18232D : 0xFF131A22);
                fill(graphics, listX, rowTop, listX + 3, rowTop + ROW_HEIGHT - 4,
                        module.enabled ? 0xFF3DD6B0 : 0xFF465261);
                int stateLeft = listRight - 58;
                drawFit(graphics, module.name, listX + 12, rowTop + 7,
                        Math.max(12, stateLeft - listX - 20), selected ? 0xFFFFFFFF : 0xFFDCE3EA);
                fill(graphics, stateLeft, rowTop + 8, listRight - 8, rowTop + 27,
                        module.enabled ? 0xFF245E52 : 0xFF303A46);
                draw(graphics, module.enabled ? "ON" : "OFF", stateLeft + 9, rowTop + 11,
                        module.enabled ? 0xFFB9FFE9 : 0xFFB8C2CC);
            }

            fill(graphics, listX, panelY + panelHeight - 49, listRight, panelY + panelHeight - 48, 0xFF27313D);
            int previousPageLeft = listRight - 136;
            drawFit(graphics, "PAGE " + (page + 1) + " / " + (maxPage + 1),
                    listX, panelY + panelHeight - 29, previousPageLeft - listX - 10, 0xFF9BAAB8);
            drawButton(graphics, listRight - 136, panelY + panelHeight - 38, listRight - 76,
                    panelY + panelHeight - 14, "<", mouseX, mouseY, page > 0 ? 0xFF293542 : 0xFF1B222B);
            drawButton(graphics, listRight - 68, panelY + panelHeight - 38, listRight - 8,
                    panelY + panelHeight - 14, ">", mouseX, mouseY, page < maxPage ? 0xFF293542 : 0xFF1B222B);

            renderDetails(graphics, mouseX, mouseY, detailsX, detailsRight, panelY, panelHeight);
        } catch (ReflectiveOperationException error) {
            reportUiFailure("render", error);
        }
    }

    public void click(Object screen, Object event) {
        if (uiFailureReported) {
            return;
        }
        try {
            if (((Number) mouseButtonMethod.invoke(event)).intValue() != 0) {
                return;
            }
            double mouseX = ((Number) mouseXMethod.invoke(event)).doubleValue();
            double mouseY = ((Number) mouseYMethod.invoke(event)).doubleValue();
            finishNumberEdit();
            int screenWidth = widthField.getInt(screen);
            int screenHeight = heightField.getInt(screen);
            int[] layout = layout(screenWidth, screenHeight);
            int panelX = layout[0];
            int panelY = layout[1];
            int panelWidth = layout[2];
            int panelHeight = layout[3];
            int sidebarRight = layout[4];
            int listX = layout[5];
            int listRight = layout[6];
            int detailsX = layout[7];
            int detailsRight = layout[8];
            int listTop = layout[9];
            int listBottom = layout[10];
            int rowsPerPage = layout[11];
            if (mouseX < panelX || mouseX >= panelX + panelWidth
                    || mouseY < panelY || mouseY >= panelY + panelHeight) {
                return;
            }

            if (mouseY >= panelY + 20 && mouseY < panelY + 52) {
                if (mouseX >= panelX + panelWidth - 344 && mouseX < panelX + panelWidth - 198) {
                    Bl.cycleProfile();
                } else if (mouseX >= panelX + panelWidth - 192 && mouseX < panelX + panelWidth - 144) {
                    Bl.createProfile();
                } else if (mouseX >= panelX + panelWidth - 136 && mouseX < panelX + panelWidth - 78) {
                    Bl.saveConfiguration();
                } else if (mouseX >= panelX + panelWidth - 70 && mouseX < panelX + panelWidth - 12) {
                    Bl.reloadConfiguration();
                }
                return;
            }

            if (mouseX < sidebarRight) {
                List<Category> categories = availableCategories();
                int categoryIndex = (int) ((mouseY - panelY - 96) / 39);
                if (mouseY >= panelY + 96 && categoryIndex >= 0 && categoryIndex < categories.size()) {
                    selectedCategory = categoryIndex;
                    page = 0;
                    settingPage = 0;
                    selectedModule = null;
                }
                return;
            }

            List<Module> visible = visibleModules();
            int maxPage = Math.max(0, (visible.size() - 1) / rowsPerPage);
            if (mouseX >= listX && mouseX < listRight && mouseY >= panelY + panelHeight - 42) {
                if (mouseX >= listRight - 136 && mouseX < listRight - 76 && page > 0) {
                    page--;
                } else if (mouseX >= listRight - 68 && mouseX < listRight - 8 && page < maxPage) {
                    page++;
                }
                return;
            }

            if (mouseX >= listX && mouseX < listRight && mouseY >= listTop && mouseY < listBottom) {
                int row = (int) (mouseY - listTop) / ROW_HEIGHT;
                int moduleIndex = page * rowsPerPage + row;
                if (row < rowsPerPage && moduleIndex >= 0 && moduleIndex < visible.size()) {
                    Module module = visible.get(moduleIndex);
                    if (selectedModule != module) {
                        settingPage = 0;
                    }
                    selectedModule = module;
                    if (mouseX >= listRight - 66) {
                        module.toggle();
                        Bl.saveConfiguration();
                    }
                }
                return;
            }

            if (selectedModule != null && mouseX >= detailsX && mouseX < detailsRight) {
                int settingsPerPage = settingsPerPage(panelHeight);
                List<Setting> visibleSettings = visibleSettings(selectedModule);
                int maxSettingPage = Math.max(0, (visibleSettings.size() - 1) / settingsPerPage);
                settingPage = Math.min(settingPage, maxSettingPage);
                if (mouseY >= panelY + 188 && mouseY < panelY + 207) {
                    if (mouseX >= detailsRight - 50 && mouseX < detailsRight - 26 && settingPage > 0) {
                        settingPage--;
                    } else if (mouseX >= detailsRight - 24 && mouseX < detailsRight
                            && settingPage < maxSettingPage) {
                        settingPage++;
                    }
                    return;
                }
                int toggleY = panelY + 89;
                int keybindY = panelY + 138;
                if (mouseY >= toggleY && mouseY < toggleY + 28
                        && mouseX >= detailsRight - 100) {
                    selectedModule.toggle();
                    Bl.saveConfiguration();
                    return;
                }
                if (mouseY >= keybindY && mouseY < keybindY + 28
                        && mouseX >= detailsRight - 150) {
                    bindingSetting = null;
                    bindingModule = selectedModule;
                    return;
                }
                int firstSetting = settingPage * settingsPerPage;
                int endSetting = Math.min(visibleSettings.size(), firstSetting + settingsPerPage);
                for (int settingIndex = firstSetting; settingIndex < endSetting; settingIndex++) {
                    Setting setting = visibleSettings.get(settingIndex);
                    int rowTop = panelY + SETTING_ROW_TOP + (settingIndex - firstSetting) * SETTING_ROW_HEIGHT;
                    if (mouseY < rowTop || mouseY >= rowTop + SETTING_ROW_HEIGHT - 2) {
                        continue;
                    }
                    if (setting.type == Setting.Type.INT || setting.type == Setting.Type.DOUBLE) {
                        int[] slider = sliderBounds(detailsX, detailsRight);
                        int inputLeft = detailsRight - 92;
                        if (mouseY < rowTop + 23 && mouseX >= inputLeft && mouseX < detailsRight - 8) {
                            editingNumberSetting = setting;
                            numberInput = numericValue(setting);
                            numberInputDirty = false;
                            numberInputInvalid = false;
                            draggingSetting = null;
                        } else if (mouseY >= rowTop + 22
                                && mouseX >= slider[0] - 6 && mouseX <= slider[1] + 6) {
                            editingNumberSetting = null;
                            draggingSetting = setting;
                            updateSlider(setting, mouseX, slider[0], slider[1]);
                            numberInputInvalid = false;
                            Bl.saveConfiguration();
                        } else {
                            editingNumberSetting = null;
                            draggingSetting = null;
                        }
                    } else {
                        editingNumberSetting = null;
                        draggingSetting = null;
                        adjustSetting(setting, mouseX, detailsRight - 100, detailsRight - 16);
                        Bl.saveConfiguration();
                    }
                    return;
                }
            }
        } catch (ReflectiveOperationException error) {
            reportUiFailure("handle input for", error);
        }
    }

    public boolean mouseDragged(Object event) {
        if (draggingSetting == null) {
            return false;
        }
        try {
            double mouseX = ((Number) mouseXMethod.invoke(event)).doubleValue();
            int[] layout = layout(widthField.getInt(menu), heightField.getInt(menu));
            int[] slider = sliderBounds(layout[7], layout[8]);
            updateSlider(draggingSetting, mouseX, slider[0], slider[1]);
            numberInputInvalid = false;
            return true;
        } catch (ReflectiveOperationException error) {
            reportUiFailure("drag numeric setting in", error);
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
        if ((bindingModule == null && bindingSetting == null && editingNumberSetting == null) || keyCodeMethod == null) {
            return false;
        }
        try {
            int keyCode = ((Number) keyCodeMethod.invoke(event)).intValue();
            if (editingNumberSetting != null) {
                return handleNumberKey(keyCode);
            }
            if (bindingSetting != null) {
                bindingSetting.setKey(keyCode == 256 ? 0 : keyCode);
            } else {
                bindingModule.keybind = keyCode == 256 ? 0 : keyCode;
            }
            bindingModule = null;
            bindingSetting = null;
            Bl.saveConfiguration();
            return true;
        } catch (ReflectiveOperationException error) {
            reportUiFailure("read keybind input for", error);
            return false;
        }
    }

    private boolean handleNumberKey(int keyCode) {
        if (keyCode == 256) {
            editingNumberSetting = null;
            numberInputInvalid = false;
            return true;
        }
        if (keyCode == 257 || keyCode == 335) {
            if (!numberInputDirty) {
                editingNumberSetting = null;
                return true;
            }
            try {
                if (editingNumberSetting.type == Setting.Type.INT) {
                    editingNumberSetting.setInt(Integer.parseInt(numberInput));
                } else {
                    editingNumberSetting.setDouble(Double.parseDouble(numberInput));
                }
                Bl.saveConfiguration();
                editingNumberSetting = null;
                numberInputInvalid = false;
            } catch (NumberFormatException error) {
                numberInputInvalid = true;
            }
            return true;
        }
        if (keyCode == 259) {
            if (!numberInputDirty) {
                numberInput = "";
                numberInputDirty = true;
            } else if (!numberInput.isEmpty()) {
                numberInput = numberInput.substring(0, numberInput.length() - 1);
            }
            numberInputInvalid = false;
            return true;
        }
        char character = numericCharacter(keyCode);
        if (character == 0) {
            return true;
        }
        if (numberInput.length() >= 16) {
            return true;
        }
        String candidate = numberInputDirty ? numberInput : "";
        if (character == '-' && (editingNumberSetting.type == Setting.Type.INT
                ? editingNumberSetting.getMin() >= 0 : editingNumberSetting.getDMin() >= 0)) {
            return true;
        }
        if ((character == '.' && (editingNumberSetting.type == Setting.Type.INT || candidate.contains(".")))
                || (character == '-' && (!candidate.isEmpty() || candidate.contains("-")))) {
            return true;
        }
        numberInput = candidate + character;
        numberInputDirty = true;
        numberInputInvalid = false;
        return true;
    }

    private char numericCharacter(int keyCode) {
        if (keyCode >= 48 && keyCode <= 57) {
            return (char) keyCode;
        }
        if (keyCode >= 320 && keyCode <= 329) {
            return (char) ('0' + keyCode - 320);
        }
        return switch (keyCode) {
            case 45, 333 -> '-';
            case 46, 330 -> '.';
            default -> 0;
        };
    }

    private void finishNumberEdit() {
        if (editingNumberSetting == null) {
            return;
        }
        if (numberInputDirty) {
            try {
                if (editingNumberSetting.type == Setting.Type.INT) {
                    editingNumberSetting.setInt(Integer.parseInt(numberInput));
                } else {
                    editingNumberSetting.setDouble(Double.parseDouble(numberInput));
                }
                Bl.saveConfiguration();
            } catch (NumberFormatException ignored) {
            }
        }
        editingNumberSetting = null;
        numberInputInvalid = false;
    }

    private int[] layout(int screenWidth, int screenHeight) {
        int panelWidth = Math.max(1, Math.min(PANEL_WIDTH, screenWidth - 24));
        int panelHeight = Math.max(1, Math.min(PANEL_HEIGHT, screenHeight - 24));
        int panelX = Math.max(0, (screenWidth - panelWidth) / 2);
        int panelY = Math.max(0, (screenHeight - panelHeight) / 2);
        int sidebarWidth = Math.min(MAX_SIDEBAR_WIDTH,
                Math.max(MIN_SIDEBAR_WIDTH, panelWidth * 28 / 100));
        sidebarWidth = Math.min(sidebarWidth, Math.max(1, panelWidth / 3));
        int sidebarRight = panelX + sidebarWidth;
        int listX = sidebarRight + 16;
        int detailsRight = panelX + panelWidth - 16;
        int availableColumns = Math.max(2, detailsRight - listX - 16);
        int moduleListWidth = Math.min(420, Math.max(180, availableColumns * 52 / 100));
        moduleListWidth = Math.min(moduleListWidth, Math.max(1, availableColumns - 220));
        int listRight = listX + moduleListWidth;
        int detailsX = listRight + 16;
        int listTop = panelY + 122;
        int listBottom = panelY + panelHeight - 58;
        int rowsPerPage = Math.max(1, (listBottom - listTop) / ROW_HEIGHT);
        return new int[] { panelX, panelY, panelWidth, panelHeight, sidebarRight, listX, listRight,
                detailsX, detailsRight, listTop, listBottom, rowsPerPage };
    }

    private void renderDetails(Object graphics, int mouseX, int mouseY,
            int detailsX, int detailsRight, int panelY, int panelHeight) throws ReflectiveOperationException {
        if (selectedModule == null) {
            fill(graphics, detailsX, panelY + 88, detailsRight, panelY + 170, 0xFF131C25);
            fill(graphics, detailsX, panelY + 88, detailsX + 3, panelY + 170, 0xFF3DD6B0);
            int textX = detailsX + 14;
            int textWidth = detailsRight - textX - 12;
            drawFit(graphics, "PICK A MODULE", textX, panelY + 101, textWidth, 0xFFFFFFFF);
            drawWrapped(graphics, "Select a module to view its settings and keybind.",
                    textX, panelY + 122, textWidth, 2, 12, 0xFF8997A7);
            drawFit(graphics, "Changes are saved to the active profile.",
                    textX, panelY + 153, textWidth, 0xFF657586);
            return;
        }

        fill(graphics, detailsX, panelY + 83, detailsRight, panelY + 171, 0xFF131C25);
        fill(graphics, detailsX, panelY + 83, detailsX + 3, panelY + 171,
                selectedModule.enabled ? 0xFF3DD6B0 : 0xFF465261);
        drawFit(graphics, selectedModule.name, detailsX + 12, panelY + 98,
                detailsRight - detailsX - 124, 0xFFFFFFFF);
        String category = categoryName(selectedModule.category).toUpperCase();
        drawFit(graphics, category, detailsX + 12, panelY + 126, 78, 0xFF8191A2);
        drawButton(graphics, detailsRight - 94, panelY + 89, detailsRight, panelY + 117,
                selectedModule.enabled ? "DISABLE" : "ENABLE", mouseX, mouseY,
                selectedModule.enabled ? 0xFF245E52 : 0xFF293542);
        drawFit(graphics, "KEYBIND", detailsX + 12, panelY + 153,
                detailsRight - detailsX - 166, 0xFF9BAAB8);
        String keyText = bindingModule == selectedModule ? "PRESS A KEY..." :
                selectedModule.keybind == 0 ? "UNBOUND" : "KEY " + selectedModule.keybind;
        drawButton(graphics, detailsRight - 142, panelY + 138, detailsRight, panelY + 166,
                keyText, mouseX, mouseY, bindingModule == selectedModule ? 0xFF59472B : 0xFF293542);
        int settingsPerPage = settingsPerPage(panelHeight);
        List<Setting> visibleSettings = visibleSettings(selectedModule);
        int maxSettingPage = Math.max(0, (visibleSettings.size() - 1) / settingsPerPage);
        settingPage = Math.min(settingPage, maxSettingPage);
        draw(graphics, "SETTINGS", detailsX + 10, panelY + 197, 0xFFFFFFFF);
        if (maxSettingPage > 0) {
            drawButton(graphics, detailsRight - 50, panelY + 188, detailsRight - 26, panelY + 207,
                    "<", mouseX, mouseY, settingPage > 0 ? 0xFF293542 : 0xFF1B222B);
            draw(graphics, (settingPage + 1) + "/" + (maxSettingPage + 1),
                    detailsRight - 82, panelY + 193, 0xFF9BAAB8);
            drawButton(graphics, detailsRight - 24, panelY + 188, detailsRight, panelY + 207,
                    ">", mouseX, mouseY, settingPage < maxSettingPage ? 0xFF293542 : 0xFF1B222B);
        }

        int firstSetting = settingPage * settingsPerPage;
        int endSetting = Math.min(visibleSettings.size(), firstSetting + settingsPerPage);
        for (int settingIndex = firstSetting; settingIndex < endSetting; settingIndex++) {
            Setting setting = visibleSettings.get(settingIndex);
            int rowTop = panelY + SETTING_ROW_TOP + (settingIndex - firstSetting) * SETTING_ROW_HEIGHT;
            if (rowTop + SETTING_ROW_HEIGHT > panelY + panelHeight - SETTING_BOTTOM_PADDING) {
                break;
            }
            boolean hovered = mouseX >= detailsX && mouseX < detailsRight
                    && mouseY >= rowTop && mouseY < rowTop + SETTING_ROW_HEIGHT - 2;
            fill(graphics, detailsX, rowTop, detailsRight, rowTop + SETTING_ROW_HEIGHT - 2,
                    hovered ? 0xFF19232E : 0xFF141B23);
            String value = bindingSetting == setting ? "PRESS A KEY..." : settingValue(setting);
            int inputLeft = detailsRight - 92;
            int labelRight = switch (setting.type) {
                case INT, DOUBLE -> inputLeft - 12;
                case BOOL -> detailsRight - 112;
                default -> detailsRight - 112;
            };
            drawFit(graphics, setting.name, detailsX + 10, rowTop + 9,
                    Math.max(12, labelRight - detailsX - 10), 0xFFDCE3EA);
            if (setting.type == Setting.Type.INT || setting.type == Setting.Type.DOUBLE) {
                int[] slider = sliderBounds(detailsX, detailsRight);
                int trackY = rowTop + 34;
                double progress = settingProgress(setting);
                int thumbX = slider[0] + (int) Math.round(progress * (slider[1] - slider[0]));
                fill(graphics, slider[0], trackY - 2, slider[1], trackY + 2, 0xFF35414E);
                fill(graphics, slider[0], trackY - 2, thumbX, trackY + 2, 0xFF3DD6B0);
                fill(graphics, thumbX - 4, trackY - 6, thumbX + 5, trackY + 7, 0xFFB9FFE9);
                boolean editing = editingNumberSetting == setting;
                fill(graphics, inputLeft, rowTop + 3, detailsRight - 8, rowTop + 22,
                        numberInputInvalid && editing ? 0xFF5A292D : editing ? 0xFF24443F : 0xFF252F3A);
                drawFit(graphics, editing ? numberInput : value, inputLeft + 5, rowTop + 8,
                        detailsRight - inputLeft - 18,
                        numberInputInvalid && editing ? 0xFFFF9B9B : 0xFFE0E7EE);
            } else if (setting.type == Setting.Type.BOOL) {
                int switchLeft = detailsRight - 50;
                fill(graphics, switchLeft, rowTop + 7, detailsRight - 10, rowTop + 27,
                        setting.getBool() ? 0xFF245E52 : 0xFF303A46);
                int knobLeft = setting.getBool() ? switchLeft + 22 : switchLeft + 2;
                fill(graphics, knobLeft, rowTop + 9, knobLeft + 16, rowTop + 25, 0xFFE0E7EE);
                draw(graphics, value, detailsRight - 87, rowTop + 14,
                        setting.getBool() ? 0xFF8FEAD3 : 0xFF9AA9B9);
            } else {
                fill(graphics, detailsRight - 96, rowTop + 9, detailsRight - 8, rowTop + 33,
                        hovered ? 0xFF293542 : 0xFF222C37);
                drawFit(graphics, value, detailsRight - 91, rowTop + 16,
                        78, 0xFFB8C2CC);
            }
        }
    }

    private List<Setting> visibleSettings(Module module) {
        List<Setting> visible = new ArrayList<>();
        for (Setting setting : module.settings) {
            if (setting.visible()) {
                visible.add(setting);
            }
        }
        return visible;
    }

    private int settingsPerPage(int panelHeight) {
        return Math.max(1, (panelHeight - SETTING_ROW_TOP - SETTING_BOTTOM_PADDING) / SETTING_ROW_HEIGHT);
    }

    private String settingValue(Setting setting) {
        return switch (setting.type) {
            case BOOL -> setting.getBool() ? "ON" : "OFF";
            case INT -> Integer.toString(setting.getInt());
            case DOUBLE -> String.format("%.2f", setting.getDouble());
            case ENUM -> setting.getEnum();
            case COLOR -> String.format("#%06X", setting.getColor() & 0xFFFFFF);
            case KEY -> setting.getKey() == 0 ? "UNBOUND" : "KEY " + setting.getKey();
        };
    }

    private String numericValue(Setting setting) {
        return setting.type == Setting.Type.INT ? Integer.toString(setting.getInt())
                : String.format(java.util.Locale.ROOT, "%.2f", setting.getDouble());
    }

    private int[] sliderBounds(int detailsX, int detailsRight) {
        int left = detailsX + 12;
        int right = detailsRight - 12;
        if (right <= left) {
            right = left + 1;
        }
        return new int[] { left, right };
    }

    private double settingProgress(Setting setting) {
        if (setting.type == Setting.Type.INT) {
            int range = setting.getMax() - setting.getMin();
            return range == 0 ? 0.0 : (double) (setting.getInt() - setting.getMin()) / range;
        }
        double range = setting.getDMax() - setting.getDMin();
        return range == 0.0 ? 0.0 : (setting.getDouble() - setting.getDMin()) / range;
    }

    private void updateSlider(Setting setting, double mouseX, int sliderLeft, int sliderRight) {
        double progress = Math.max(0.0, Math.min(1.0,
                (mouseX - sliderLeft) / Math.max(1.0, sliderRight - sliderLeft)));
        if (setting.type == Setting.Type.INT) {
            int range = setting.getMax() - setting.getMin();
            setting.setInt(setting.getMin() + (int) Math.round(progress * range));
        } else {
            setting.setDouble(setting.getDMin() + progress * (setting.getDMax() - setting.getDMin()));
        }
    }

    private String profileLabel() {
        String label = "PROFILE: " + Bl.currentProfile();
        return label.length() > 22 ? label.substring(0, 19) + "..." : label;
    }

    private void adjustSetting(Setting setting, double mouseX, int left, int right) {
        switch (setting.type) {
            case BOOL -> setting.setBool(!setting.getBool());
            case INT -> {
                int step = Math.max(1, (setting.getMax() - setting.getMin()) / 10);
                setting.setInt(setting.getInt() + (mouseX < (left + right) / 2.0 ? -step : step));
            }
            case DOUBLE -> {
                double step = Math.max(0.01, (setting.getDMax() - setting.getDMin()) / 10.0);
                setting.setDouble(setting.getDouble() + (mouseX < (left + right) / 2.0 ? -step : step));
            }
            case ENUM -> {
                List<String> options = setting.getOptions();
                if (options != null && !options.isEmpty()) {
                    int current = options.indexOf(setting.getEnum());
                    setting.setEnum(options.get((current + 1 + options.size()) % options.size()));
                }
            }
            case COLOR -> {
                int[] colors = { 0xFF3FA9F5, 0xFF43D6B0, 0xFFFF6B6B, 0xFFFFD166, 0xFFB388EB };
                int current = 0;
                for (int index = 0; index < colors.length; index++) {
                    if (setting.getColor() == colors[index]) {
                        current = index;
                        break;
                    }
                }
                setting.setColor(colors[(current + 1) % colors.length]);
            }
            case KEY -> {
                bindingModule = null;
                bindingSetting = setting;
            }
        }
    }

    private void drawButton(Object graphics, int left, int top, int right, int bottom, String label,
            int mouseX, int mouseY, int color) throws ReflectiveOperationException {
        boolean hovered = mouseX >= left && mouseX < right && mouseY >= top && mouseY < bottom;
        fill(graphics, left, top, right, bottom, hovered ? lighten(color) : color);
        int textWidth = Math.min(fontWidth(label), Math.max(0, right - left - 12));
        drawFit(graphics, label, left + (right - left - textWidth) / 2,
                top + (bottom - top - 8) / 2, right - left - 12, 0xFFF0F4F7);
    }

    private int lighten(int color) {
        int red = Math.min(255, ((color >> 16) & 0xFF) + 18);
        int green = Math.min(255, ((color >> 8) & 0xFF) + 18);
        int blue = Math.min(255, (color & 0xFF) + 18);
        return (color & 0xFF000000) | (red << 16) | (green << 8) | blue;
    }

    private int countModules(Category category) {
        if (category == null) {
            return Bl.moduleCount();
        }
        int count = 0;
        for (Module module : Bl.modules()) {
            if (module.category == category) {
                count++;
            }
        }
        return count;
    }

    private int enabledModuleCount(List<Module> modules) {
        int count = 0;
        for (Module module : modules) {
            if (module.enabled) {
                count++;
            }
        }
        return count;
    }

    private void reportUiFailure(String action, Throwable error) {
        if (!uiFailureReported) {
            uiFailureReported = true;
            System.err.println("[Bald Agent] Could not " + action + " module menu: " + error);
            error.printStackTrace(System.err);
        }
    }

    private List<Module> visibleModules() {
        List<Module> visible = new ArrayList<>();
        List<Category> categories = availableCategories();
        selectedCategory = Math.min(selectedCategory, categories.size() - 1);
        Category category = categories.get(selectedCategory);
        for (Module module : Bl.modules()) {
            if (category == null || module.category == category) {
                visible.add(module);
            }
        }
        return visible;
    }

    private List<Category> availableCategories() {
        List<Category> categories = new ArrayList<>();
        categories.add(null);
        java.util.Collections.addAll(categories, Category.values());
        return categories;
    }

    private String categoryName(Category category) {
        if (category == null) {
            return "All modules";
        }
        String name = category.name().toLowerCase();
        return Character.toUpperCase(name.charAt(0)) + name.substring(1);
    }

    private void fill(Object graphics, int left, int top, int right, int bottom, int color)
            throws ReflectiveOperationException {
        fillMethod.invoke(graphics, left, top, right, bottom, color);
    }

    private void draw(Object graphics, String text, int x, int y, int color)
            throws ReflectiveOperationException {
        drawStringMethod.invoke(graphics, fontField.get(menu), text, x, y, color);
    }

    private void drawFit(Object graphics, String text, int x, int y, int maxWidth, int color)
            throws ReflectiveOperationException {
        if (maxWidth <= 0) {
            return;
        }
        String fitted = text == null ? "" : text;
        if (fontWidth(fitted) > maxWidth) {
            String suffix = "...";
            int end = fitted.length();
            while (end > 0 && fontWidth(fitted.substring(0, end) + suffix) > maxWidth) {
                end--;
            }
            fitted = end == 0 ? "" : fitted.substring(0, end) + suffix;
        }
        draw(graphics, fitted, x, y, color);
    }

    private void drawWrapped(Object graphics, String text, int x, int y, int maxWidth,
            int maxLines, int lineHeight, int color) throws ReflectiveOperationException {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        boolean truncated = false;
        for (String word : text.split("\\s+")) {
            String candidate = line.isEmpty() ? word : line + " " + word;
            if (fontWidth(candidate) <= maxWidth) {
                line.setLength(0);
                line.append(candidate);
            } else if (line.isEmpty()) {
                lines.add(fitText(word, maxWidth));
                truncated = true;
            } else {
                lines.add(line.toString());
                line.setLength(0);
                line.append(word);
            }
            if (lines.size() == maxLines) {
                truncated = true;
                break;
            }
        }
        if (lines.size() < maxLines && !line.isEmpty()) {
            lines.add(line.toString());
        }
        if (truncated && !lines.isEmpty()) {
            String last = lines.get(lines.size() - 1);
            lines.set(lines.size() - 1, fitText(last + "...", maxWidth));
        }
        for (int index = 0; index < lines.size(); index++) {
            draw(graphics, lines.get(index), x, y + index * lineHeight, color);
        }
    }

    private String fitText(String text, int maxWidth) throws ReflectiveOperationException {
        String fitted = text;
        while (!fitted.isEmpty() && fontWidth(fitted) > maxWidth) {
            fitted = fitted.substring(0, fitted.length() - 1);
        }
        return fitted;
    }

    private int fontWidth(String text) throws ReflectiveOperationException {
        Object font = fontField.get(menu);
        Object width = fontWidthMethod.invoke(font, text);
        if (!(width instanceof Number number)) {
            throw new IllegalStateException("Minecraft font did not return a text width");
        }
        return number.intValue();
    }

    private Class<?> createMenuType() throws Exception {
        Constructor<?> screenConstructor = findScreenConstructor(screenType);
        Class<?> componentType = screenConstructor.getParameterTypes()[0];
        Method literal = findLiteral(componentType,
                Descriptors.COMPONENT_LITERAL[0][namespace == 0 ? 0 : 1]);
        Method render = findMethod(screenType, Descriptors.SCREEN_RENDER[0][namespace == 0 ? 0 : 1],
                params -> params.length == 4 && params[1] == int.class && params[2] == int.class
                        && params[3] == float.class);
        Class<?> graphicsType = render.getParameterTypes()[0];
        Method fill = findFillMethod(graphicsType);
        Method drawString = findDrawStringMethod(graphicsType);
        Field font = findField(screenType, drawString.getParameterTypes()[0]);
        Method fontWidth = findFontWidthMethod(font.getType());
        String inputListener = Descriptors.CLASS_SCREEN_MOUSE_CLICKED[namespace];
        Method mouseClicked = findPublicMappedMethod(screenType, inputListener, "mouseClicked",
                params -> params.length == 2 && params[1] == boolean.class);
        Class<?> mouseEventType = mouseClicked.getParameterTypes()[0];
        Method mouseDragged = findPublicMappedMethod(screenType, inputListener, "mouseDragged",
                params -> params.length == 3 && params[0] == mouseEventType
                        && params[1] == double.class && params[2] == double.class);
        Method mouseReleased = findPublicMappedMethod(screenType, inputListener, "mouseReleased",
                params -> params.length == 1 && params[0] == mouseEventType);
        Method mouseX = findMethod(mouseEventType,
                Descriptors.MOUSE_BUTTON_EVENT_X[0][namespace == 0 ? 0 : 1],
                params -> params.length == 0);
        Method mouseY = findMethod(mouseEventType,
                Descriptors.MOUSE_BUTTON_EVENT_Y[0][namespace == 0 ? 0 : 1],
                params -> params.length == 0);
        Method mouseButton = findMethod(mouseEventType,
                Descriptors.MOUSE_BUTTON_EVENT_BUTTON[0][namespace == 0 ? 0 : 1],
                params -> params.length == 0);
        Method keyPressed = findPublicMappedMethod(screenType, inputListener, "keyPressed",
                params -> params.length == 1);
        Method keyCode = findMethod(keyPressed.getParameterTypes()[0],
                Descriptors.KEY_EVENT_KEY[0][namespace == 0 ? 0 : 1],
                params -> params.length == 0);
        Method onClose = findNoArgVoidMethod(screenType,
                Descriptors.SCREEN_ON_CLOSE[0][namespace == 0 ? 0 : 1]);
        this.fillMethod = fill;
        this.drawStringMethod = drawString;
        this.fontWidthMethod = fontWidth;
        this.fontField = font;
        this.mouseXMethod = mouseX;
        this.mouseYMethod = mouseY;
        this.mouseButtonMethod = mouseButton;
        this.keyCodeMethod = keyCode;
        Field[] dimensions = findDimensionFields(screenType, namespace);
        this.widthField = dimensions[0];
        this.heightField = dimensions[1];

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
                    if (first.isAssignableFrom(second)) return type1;
                    if (second.isAssignableFrom(first)) return type2;
                } catch (Throwable ignored) {
                }
                return "java/lang/Object";
            }
        };
        writer.visit(Opcodes.V21, Opcodes.ACC_PUBLIC | Opcodes.ACC_FINAL | Opcodes.ACC_SUPER,
                menuInternal, null, screenInternal, null);
        addConstructor(writer, menuInternal, screenInternal, componentDescriptor, literal);
        addRender(writer, menuInternal, screenInternal, render);
        addMouseClicked(writer, mouseClicked);
        addMouseDragged(writer, screenInternal, mouseDragged);
        addMouseReleased(writer, screenInternal, mouseReleased);
        addKeyPressed(writer, screenInternal, keyPressed);
        addClose(writer, menuInternal, screenInternal, onClose);
        writer.visitEnd();

        MethodHandles.Lookup lookup = MethodHandles.privateLookupIn(screenType, MethodHandles.lookup());
        return lookup.defineClass(writer.toByteArray());
    }

    private static void addConstructor(ClassWriter writer, String menuInternal, String screenInternal,
            String componentDescriptor, Method literal) {
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitLdcInsn("Bald Agent Modules");
        method.visitMethodInsn(Opcodes.INVOKESTATIC, Type.getInternalName(literal.getDeclaringClass()),
                literal.getName(), Type.getMethodDescriptor(literal), literal.getDeclaringClass().isInterface());
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, "<init>",
                "(" + componentDescriptor + ")V", false);
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addRender(ClassWriter writer, String menuInternal, String screenInternal, Method render) {
        String descriptor = Type.getMethodDescriptor(render);
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, render.getName(), descriptor, null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        int local = 1;
        for (Class<?> parameter : render.getParameterTypes()) {
            Type type = Type.getType(parameter);
            method.visitVarInsn(type.getOpcode(Opcodes.ILOAD), local);
            local += type.getSize();
        }
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, render.getName(), descriptor, false);
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitVarInsn(Opcodes.ILOAD, 2);
        method.visitVarInsn(Opcodes.ILOAD, 3);
        method.visitVarInsn(Opcodes.FLOAD, 4);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, BL_OWNER, "renderMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;IIF)V", false);
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseClicked(ClassWriter writer, Method mouseClicked) {
        String descriptor = Type.getMethodDescriptor(mouseClicked);
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseClicked.getName(), descriptor, null, null);
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, BL_OWNER, "clickMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)V", false);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseDragged(ClassWriter writer, String screenInternal, Method mouseDragged) {
        String descriptor = Type.getMethodDescriptor(mouseDragged);
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseDragged.getName(), descriptor, null, null);
        Label notDragging = new Label();
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, BL_OWNER, "dragMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)Z", false);
        method.visitJumpInsn(Opcodes.IFEQ, notDragging);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(Opcodes.IRETURN);
        method.visitLabel(notDragging);
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitVarInsn(Opcodes.DLOAD, 2);
        method.visitVarInsn(Opcodes.DLOAD, 4);
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, mouseDragged.getName(), descriptor, false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addMouseReleased(ClassWriter writer, String screenInternal, Method mouseReleased) {
        String descriptor = Type.getMethodDescriptor(mouseReleased);
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, mouseReleased.getName(), descriptor, null, null);
        Label notDragging = new Label();
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, BL_OWNER, "releaseMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)Z", false);
        method.visitJumpInsn(Opcodes.IFEQ, notDragging);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(Opcodes.IRETURN);
        method.visitLabel(notDragging);
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, mouseReleased.getName(), descriptor, false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static void addKeyPressed(ClassWriter writer, String screenInternal, Method keyPressed) {
        String descriptor = Type.getMethodDescriptor(keyPressed);
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, keyPressed.getName(), descriptor, null, null);
        Label notBound = new Label();
        method.visitCode();
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, BL_OWNER, "keyMenu",
                "(Ljava/lang/Object;Ljava/lang/Object;)Z", false);
        method.visitJumpInsn(Opcodes.IFEQ, notBound);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(Opcodes.IRETURN);
        method.visitLabel(notBound);
        method.visitVarInsn(Opcodes.ALOAD, 0);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, screenInternal, keyPressed.getName(), descriptor, false);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static Field[] findDimensionFields(Class<?> type, int namespace) throws NoSuchFieldException {
        String widthName = namespace == 0 ? "o" : "field_22789";
        String heightName = namespace == 0 ? "p" : "field_22790";
        Field width = findFieldNamed(type, widthName);
        Field height = findFieldNamed(type, heightName);
        width.setAccessible(true);
        height.setAccessible(true);
        return new Field[] { width, height };
    }

    private static Field findFieldNamed(Class<?> type, String name) throws NoSuchFieldException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            try {
                return current.getDeclaredField(name);
            } catch (NoSuchFieldException ignored) {
                // Continue through the Screen hierarchy.
            }
        }
        throw new NoSuchFieldException(type.getName() + "#" + name);
    }

    private static void addClose(ClassWriter writer, String menuInternal, String screenInternal, Method onClose) {
        String descriptor = Type.getMethodDescriptor(onClose);
        MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, onClose.getName(), descriptor, null, null);
        method.visitCode();
        method.visitMethodInsn(Opcodes.INVOKESTATIC, BL_OWNER, "closeMenu", "()V", false);
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(0, 0);
        method.visitEnd();
    }

    private static Method findSingleton(Class<?> minecraftType) throws NoSuchMethodException {
        for (Method method : allMethods(minecraftType)) {
            if (Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 0
                    && method.getReturnType() == minecraftType) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException("Minecraft singleton accessor");
    }

    private static Method findSetScreen(Class<?> minecraftType, Class<?> screenType) throws NoSuchMethodException {
        for (Method method : allMethods(minecraftType)) {
            if (!Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 1
                    && method.getParameterTypes()[0] == screenType && method.getReturnType() == void.class) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException("Minecraft screen setter");
    }

    private static Field findScreenField(Class<?> minecraftType, Class<?> screenType) throws NoSuchFieldException {
        for (Class<?> type = minecraftType; type != null; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (field.getType() == screenType) {
                    field.setAccessible(true);
                    return field;
                }
            }
        }
        throw new NoSuchFieldException("Minecraft active screen field");
    }

    private static Constructor<?> findScreenConstructor(Class<?> screenType) throws NoSuchMethodException {
        for (Constructor<?> constructor : screenType.getDeclaredConstructors()) {
            if (constructor.getParameterCount() == 1) {
                return constructor;
            }
        }
        throw new NoSuchMethodException("Screen(Component) constructor");
    }

    private static Method findLiteral(Class<?> componentType, String expectedName) throws NoSuchMethodException {
        for (Method method : allMethods(componentType)) {
            if (method.getName().equals(expectedName) && Modifier.isStatic(method.getModifiers())
                    && method.getParameterCount() == 1
                    && method.getParameterTypes()[0] == String.class
                    && componentType.isAssignableFrom(method.getReturnType())) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(componentType.getName() + "#" + expectedName);
    }

    private static Method findMethod(Class<?> type, String expectedName,
            java.util.function.Predicate<Class<?>[]> parametersMatch) throws NoSuchMethodException {
        for (Method method : allMethods(type)) {
            Class<?>[] params = method.getParameterTypes();
            if (method.getName().equals(expectedName) && parametersMatch.test(params)) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(type.getName() + "#" + expectedName);
    }

    private static Method findPublicMappedMethod(Class<?> type, String mappingOwner, String namedName,
            java.util.function.Predicate<Class<?>[]> parametersMatch) throws NoSuchMethodException {
        String ownerName = mappingOwner.replace('/', '.');
        List<String> mappedNames = RuntimeMappings.memberNames(ownerName, namedName, false);
        for (Method method : type.getMethods()) {
            if (parametersMatch.test(method.getParameterTypes())
                    && mappedNames.contains(method.getName())) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(type.getName() + "#" + namedName);
    }

    private static Method findFillMethod(Class<?> graphicsType) throws NoSuchMethodException {
        List<String> fillNames = RuntimeMappings.memberNames(graphicsType.getName(), "fill", false);
        for (Method method : graphicsType.getDeclaredMethods()) {
            Class<?>[] params = method.getParameterTypes();
            if (fillNames.contains(method.getName()) && method.getReturnType() == void.class && params.length == 5
                    && all(params, int.class) && Modifier.isPublic(method.getModifiers())) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException("GuiGraphics fill method");
    }

    private static Method findDrawStringMethod(Class<?> graphicsType) throws NoSuchMethodException {
        List<String> drawNames = RuntimeMappings.memberNames(graphicsType.getName(), "drawString", false);
        for (Method method : graphicsType.getDeclaredMethods()) {
            Class<?>[] params = method.getParameterTypes();
            if (drawNames.contains(method.getName()) && method.getReturnType() == void.class
                    && params.length == 5 && params[1] == String.class
                    && params[2] == int.class && params[3] == int.class && params[4] == int.class
                    && Modifier.isPublic(method.getModifiers())) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(graphicsType.getName() + "#drawString(Font, String, int, int, int)");
    }

    private static Method findFontWidthMethod(Class<?> fontType) throws NoSuchMethodException {
        List<String> widthNames = RuntimeMappings.memberNames(fontType.getName(), "width", false);
        for (Method method : allMethods(fontType)) {
            if (widthNames.contains(method.getName()) && method.getReturnType() == int.class
                    && method.getParameterCount() == 1 && method.getParameterTypes()[0] == String.class) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException(fontType.getName() + "#width(String)");
    }

    private static Method findNoArgVoidMethod(Class<?> type, String expectedName) throws NoSuchMethodException {
        for (Method method : allMethods(type)) {
            if (method.getName().equals(expectedName) && method.getParameterCount() == 0
                    && method.getReturnType() == void.class) {
                method.setAccessible(true);
                return method;
            }
        }
        throw new NoSuchMethodException("Screen close method: " + expectedName);
    }

    private static Field findField(Class<?> type, Class<?> fieldType) throws NoSuchFieldException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Field field : current.getDeclaredFields()) {
                if (field.getType() == fieldType) {
                    field.setAccessible(true);
                    return field;
                }
            }
        }
        throw new NoSuchFieldException("Screen font field");
    }

    private static List<Method> allMethods(Class<?> type) {
        List<Method> methods = new ArrayList<>();
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Method method : current.getDeclaredMethods()) {
                methods.add(method);
            }
        }
        return methods;
    }

    private static boolean all(Class<?>[] types, Class<?> expected) {
        for (Class<?> type : types) {
            if (type != expected) return false;
        }
        return true;
    }

    private static String descriptorClass(String methodDescriptor) {
        int start = methodDescriptor.indexOf('L');
        int end = methodDescriptor.indexOf(';', start);
        if (start < 0 || end < 0) {
            throw new IllegalArgumentException("Expected screen class descriptor: " + methodDescriptor);
        }
        return methodDescriptor.substring(start + 1, end);
    }

}
