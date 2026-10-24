package com.baldlauncher.client.mixin;

import com.baldlauncher.client.BaldLauncherClient;
import com.baldlauncher.client.BaldPauseScreen;
import com.baldlauncher.client.BaldClientButtonWidget;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(GameMenuScreen.class)
public abstract class PauseScreenMixin {
    @Inject(method = "init", at = @At("HEAD"), cancellable = true)
    private void bald$replacePauseMenu(CallbackInfo callback) {
        if (BaldLauncherClient.shouldReplacePauseMenu()) {
            MinecraftClient.getInstance().setScreen(new BaldPauseScreen());
            callback.cancel();
        }
    }

    @Inject(method = "init", at = @At("TAIL"))
    private void bald$addPerformanceButton(CallbackInfo callback) {
        if (BaldLauncherClient.shouldAddPerformanceButton()) {
            GameMenuScreen screen = (GameMenuScreen) (Object) this;
            ((ScreenAccessor) screen).bald$addDrawableChild(new BaldClientButtonWidget(
                    screen.width - 150, 8, 142, 24, Text.literal("Bald Performance"), true, true,
                    () -> MinecraftClient.getInstance().setScreen(
                            new com.baldlauncher.client.BaldPerformanceScreen(screen))));
        }
    }
}
