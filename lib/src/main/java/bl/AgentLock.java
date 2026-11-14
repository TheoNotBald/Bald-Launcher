package bl;

import java.util.logging.Logger;

import bl.module.movement.NoFall;

public final class AgentLock {

    private static final String TARGET_VERSION = "1.21.11";
    private static final Logger LOGGER = Logger.getLogger("BaldLauncher");

    private static volatile boolean locked;
    private static volatile boolean armed;
    private static int graceTicks;

    private AgentLock() {
    }

    public static boolean isLocked() {
        return locked;
    }

    public static void arm() {
        armed = true;
        graceTicks = Integer.MAX_VALUE;
    }

    public static boolean engage() {
        if (!armed || locked) {
            return false;
        }
        locked = true;
        NoFall.INSTANCE.disable();
        LOGGER.info("[BaldLauncher] agent locked on remote join (target " + TARGET_VERSION + ")");
        return true;
    }

    public static void enforceDisabled() {
        if (!locked) {
            return;
        }
        if (graceTicks-- > 0) {
            return;
        }
        Bl.disableAllModules();
    }

    public static void release() {
        locked = false;
        armed = false;
        graceTicks = 0;
    }
}
