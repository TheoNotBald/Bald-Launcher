package com.baldlauncher.client.mixin;

import com.baldlauncher.client.BaldLauncherClient;
import net.minecraft.client.Mouse;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.input.MouseInput;
import net.minecraft.client.util.Window;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Mouse.class)
public abstract class MouseMixin {
    @Inject(method = "onMouseButton", at = @At("HEAD"), cancellable = true)
    private void bald$handleHudButton(long windowHandle, MouseInput input, int action,
                                      CallbackInfo callback) {
        if (action != GLFW.GLFW_PRESS
                || input.button() != GLFW.GLFW_MOUSE_BUTTON_LEFT
                && input.button() != GLFW.GLFW_MOUSE_BUTTON_RIGHT) return;
        MinecraftClient client = MinecraftClient.getInstance();
        BaldLauncherClient.registerMouseClick(input.button());
        if (input.button() != GLFW.GLFW_MOUSE_BUTTON_LEFT) return;
        Window window = client.getWindow();
        double mouseX = client.mouse.getX() * window.getScaledWidth() / window.getWidth();
        double mouseY = client.mouse.getY() * window.getScaledHeight() / window.getHeight();
        if (BaldLauncherClient.handleInGameButtonClick(mouseX, mouseY)) callback.cancel();
    }
}
