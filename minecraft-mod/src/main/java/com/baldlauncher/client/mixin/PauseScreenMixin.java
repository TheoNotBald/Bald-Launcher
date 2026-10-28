package com.baldlauncher.client.mixin;

import com.baldlauncher.client.BaldLauncherClient;
import com.baldlauncher.client.BaldPauseScreen;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(GameMenuScreen.class)
public abstract class PauseScreenMixin {
    @Inject(method = "init", at = @At("TAIL"))
    private void bald$integratePauseMenu(CallbackInfo callback) {
        GameMenuScreen screen = (GameMenuScreen) (Object) this;
        if (MinecraftClient.getInstance().currentScreen != screen) return;
        if (BaldLauncherClient.shouldReplacePauseMenu()) {
            MinecraftClient.getInstance().setScreen(new BaldPauseScreen());
            return;
        }
        BaldLauncherClient.addPerformanceButton(screen);
    }
}
