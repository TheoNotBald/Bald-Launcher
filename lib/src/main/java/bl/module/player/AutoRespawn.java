package bl.module.player;

import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AutoRespawn extends Module {

    private final Setting delay = setting(Setting.integer("Delay", 0, 0, 200));
    private int ticksUntilRespawn = -1;
    private boolean respawnRequested;

    public AutoRespawn() {
        super("AutoRespawn", Category.PLAYER, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null) {
            reset();
            return;
        }
        Object health = Reflect.call(player, "getHealth");
        if (!(health instanceof Number number) || number.floatValue() > 0.0f) {
            reset();
            return;
        }
        if (respawnRequested) {
            return;
        }
        if (ticksUntilRespawn < 0) {
            ticksUntilRespawn = delay.getInt();
        }
        if (ticksUntilRespawn > 0) {
            ticksUntilRespawn--;
            return;
        }
        Object gameMode = Reflect.getField(Reflect.instance(), "gameMode");
        if (gameMode == null || !Reflect.invoke(gameMode, "respawn")) {
            throw new IllegalStateException("Could not respawn the local player");
        }
        respawnRequested = true;
    }

    @Override
    protected void onDisable() {
        reset();
    }

    @Override
    protected void onUnavailable() {
        reset();
    }

    private void reset() {
        ticksUntilRespawn = -1;
        respawnRequested = false;
    }
}
