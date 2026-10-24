package com.baldlauncher.client;

import net.minecraft.text.Style;
import net.minecraft.text.StyleSpriteSource;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

public final class BaldText {
    private static final Identifier FONT = Identifier.of("baldlauncher", "ui");
    private static final Identifier DISPLAY_FONT = Identifier.of("baldlauncher", "display");
    private static final Style FONT_STYLE = Style.EMPTY.withFont(font());

    private BaldText() {}

    public static Text label(String value) {
        return Text.literal(value).setStyle(FONT_STYLE);
    }

    public static Text title(String value) {
        return Text.literal(value).setStyle(FONT_STYLE.withFont(new StyleSpriteSource.Font(DISPLAY_FONT))
                .withBold(true));
    }

    public static Text button(String value, boolean prominent) {
        return Text.literal(value).setStyle(FONT_STYLE.withBold(prominent));
    }

    public static StyleSpriteSource.Font font() {
        return new StyleSpriteSource.Font(FONT);
    }
}
