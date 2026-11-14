package bl.module.combat;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.util.TimerUtil;
public final class TriggerBot extends Module {

    private final TimerUtil timer = new TimerUtil();

    private final Setting range = setting(Setting.decimal("Range", 3.0, 1.0, 6.0));
    private final Setting delay = setting(Setting.integer("Delay (ticks)", 2, 1, 20));
    private final Setting players = setting(Setting.bool("Target players", false));
    private final Setting mobs = setting(Setting.bool("Target hostile mobs", true));
    private final Setting requireAttackInput = setting(Setting.bool("Require attack input", false));
    private final Setting pauseWhileUsingItem = setting(Setting.bool("Pause while using item", true));
    private final Setting respectCooldown = setting(Setting.bool("Respect attack cooldown", true));
    private final Setting cooldown = setting(Setting.integer("Attack cooldown", 90, 0, 100));

    public TriggerBot() {
        super("TriggerBot", Category.COMBAT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        Object mc = Reflect.instance();
        if (!isAvailable() || player == null || mc == null) {
            return;
        }
        if (Reflect.fieldOfType(mc, "net/minecraft/client/gui/screens/Screen") != null) {
            return;
        }
        if (pauseWhileUsingItem.getBool()) {
            Object usingItem = Reflect.call(player, "isUsingItem");
            if (usingItem instanceof Boolean using && using) {
                return;
            }
        }
        if (requireAttackInput.getBool()) {
            Object options = Reflect.getField(mc, "options");
            Object attackKey = Reflect.getField(options, "keyAttack");
            Object down = Reflect.call(attackKey, "isPressed");
            if (!(down instanceof Boolean pressed) || !pressed) {
                return;
            }
        }
        Object crosshair = Reflect.getField(mc, "crosshairPickEntity");
        if (crosshair == null || crosshair == player) {
            return;
        }
        if (!Worlds.alive(crosshair)) {
            return;
        }
        if ((!players.getBool() || !Worlds.isPlayer(crosshair))
                && (!mobs.getBool() || !Worlds.isMob(crosshair))) {
            return;
        }
        if (Worlds.distance(player, crosshair) > range.getDouble()) {
            return;
        }
        if (respectCooldown.getBool()) {
            Object attackStrength = Reflect.call(player, "getAttackStrengthScale", 0.5f);
            if (!(attackStrength instanceof Number strength)
                    || strength.floatValue() < cooldown.getInt() / 100.0f) {
                return;
            }
        }
        if (!timer.passed(delay.getInt() * 50L)) {
            return;
        }
        Object gameMode = Reflect.fieldOfType(mc, "net/minecraft/client/multiplayer/MultiPlayerGameMode");
        if (gameMode == null || !Reflect.invoke(gameMode, "attack", player, crosshair)) {
            throw new IllegalStateException("Could not attack the current crosshair target");
        }
        Worlds.swingMainHand(player);
        timer.reset();
    }
}
