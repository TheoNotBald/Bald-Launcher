package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Sprint extends Module {

    private final Setting onlyWhileMoving = setting(Setting.bool("Only while moving", true));
    private Boolean originalSprinting;

    public Sprint() {
        super("Sprint", Category.MOVEMENT);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        if (Worlds.inLiquid(player)) {
            return;
        }
        Object moving = Reflect.call(player, "isMoving");
        if (!(moving instanceof Boolean isMoving)) {
            throw new IllegalStateException("Could not read player movement state");
        }
        if (onlyWhileMoving.getBool() && !isMoving) {
            return;
        }
        Object sneaking = Reflect.call(player, "isShiftKeyDown");
        if (sneaking instanceof Boolean bool && bool) {
            return;
        }
        Object sprinting = Reflect.call(player, "isSprinting");
        if (!(sprinting instanceof Boolean bool) || !bool) {
            if (originalSprinting == null) {
                originalSprinting = sprinting instanceof Boolean state && state;
            }
            if (!Reflect.invoke(player, "setSprinting", true)) {
                throw new IllegalStateException("Could not enable sprinting");
            }
        } else if (originalSprinting == null) {
            originalSprinting = true;
        }
    }

    @Override
    protected void onDisable() {
        Object player = Reflect.player();
        if (player != null && originalSprinting != null) {
            Object current = Reflect.call(player, "isSprinting");
            if (current instanceof Boolean state && state != originalSprinting
                    && !Reflect.invoke(player, "setSprinting", originalSprinting)) {
                throw new IllegalStateException("Could not restore sprint state");
            }
        }
        originalSprinting = null;
    }
}
