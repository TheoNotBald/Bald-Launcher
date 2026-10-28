package com.baldlauncher.client.mixin;

import com.baldlauncher.client.BaldLauncherClient;
import com.baldlauncher.client.BaldMainMenuScreen;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin {
    @Inject(method = "init", at = @At("TAIL"))
    private void bald$integrateTitleMenu(CallbackInfo callback) {
        TitleScreen screen = (TitleScreen) (Object) this;
        if (MinecraftClient.getInstance().currentScreen != screen) return;
        if (BaldLauncherClient.shouldReplaceTitleMenu()) {
            MinecraftClient.getInstance().setScreen(new BaldMainMenuScreen());
            return;
        }
        BaldLauncherClient.addPerformanceButton(screen);
    }
}
