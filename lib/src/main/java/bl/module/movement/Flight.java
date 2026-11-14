package bl.module.movement;

import java.util.List;

import bl.Bl;
import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class Flight extends Module {

    private record AbilityState(Object owner, Object abilities, boolean mayfly, boolean flying, float speed) {
    }

    private final Setting mode = setting(Setting.enumeration("Mode", "Vanilla",
            List.of("Vanilla", "Jetpack")));
    private final Setting flyingSpeed = setting(Setting.decimal("Flying speed", 0.05, 0.01, 0.5));
    private final Setting jetpackSpeed = setting(Setting.decimal("Jetpack vertical speed", 0.29, 0.05, 1.0,
            () -> mode.getEnum().equals("Jetpack")));
    private final Setting maximumFallSpeed = setting(Setting.decimal("Maximum fall speed", 0.29, 0.05, 1.0,
            () -> mode.getEnum().equals("Vanilla")));
    private final Setting dampenWhenIdle = setting(Setting.bool("Stop vertical drift", true,
            () -> mode.getEnum().equals("Jetpack")));

    private AbilityState clientState;
    private AbilityState serverState;
    private volatile boolean serverFlightUpdatePending;

    public Flight() {
        super("Flight", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        if (!isAvailable()) {
            restoreAbilities();
            return;
        }
        Object player = Reflect.player();
        Object mc = Reflect.instance();
        if (player == null || mc == null) {
            restoreAbilities();
            return;
        }

        Object clientAbilities = Reflect.call(player, "getAbilities");
        Object serverPlayer = serverPlayer(mc, player);
        Object serverAbilities = serverPlayer == null ? null : Reflect.call(serverPlayer, "getAbilities");
        if (clientAbilities == null || serverPlayer == null || serverAbilities == null) {
            restoreAbilities();
            return;
        }

        if (clientState == null || clientState.owner() != player || clientState.abilities() != clientAbilities
                || serverState == null || serverState.owner() != serverPlayer
                || serverState.abilities() != serverAbilities) {
            restoreAbilities();
            clientState = snapshot(player, clientAbilities);
            serverState = snapshot(serverPlayer, serverAbilities);
        }

        applyFlightState(clientState.abilities(), flyingSpeed.getDouble());
        synchronizeServerFlight(Reflect.call(mc, "getSingleplayerServer"), serverState, flyingSpeed.getDouble());

        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null) {
            throw new IllegalStateException("Could not read player flight movement");
        }
        double y = component(motion, "y");
        if (mode.getEnum().equals("Jetpack")) {
            Object input = Reflect.getField(player, "input");
            Object playerInput = input == null ? null : Reflect.getField(input, "playerInput");
            boolean up = pressed(playerInput, "jump");
            boolean down = pressed(playerInput, "sneak");
            if (up != down) {
                y = up ? jetpackSpeed.getDouble() : -jetpackSpeed.getDouble();
            } else if (dampenWhenIdle.getBool()) {
                y = 0.0;
            } else {
                y *= 0.6;
            }
        } else if (y < -maximumFallSpeed.getDouble()) {
            y = -maximumFallSpeed.getDouble();
        }
        if (!Reflect.invoke(player, "setDeltaMovement", component(motion, "x"), y, component(motion, "z"))) {
            throw new IllegalStateException("Could not update player flight movement");
        }
    }

    @Override
    protected void onDisable() {
        restoreAbilities();
    }

    @Override
    protected void onUnavailable() {
        restoreAbilities();
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }

    private Object serverPlayer(Object mc, Object player) {
        Object server = Reflect.call(mc, "getSingleplayerServer");
        Object playerList = Reflect.call(server, "getPlayerList");
        Object uuid = Reflect.call(player, "getUUID");
        return uuid == null ? null : Reflect.call(playerList, "getPlayer", uuid);
    }

    private AbilityState snapshot(Object owner, Object abilities) {
        Object mayfly = Reflect.getField(abilities, "mayfly");
        Object flying = Reflect.getField(abilities, "flying");
        Object speed = Reflect.call(abilities, "getFlyingSpeed");
        if (!(mayfly instanceof Boolean mayflyValue) || !(flying instanceof Boolean flyingValue)
                || !(speed instanceof Number speedValue)) {
            throw new IllegalStateException("Could not read player flight ability state");
        }
        return new AbilityState(owner, abilities, mayflyValue, flyingValue, speedValue.floatValue());
    }

    private boolean applyFlightState(Object abilities, double speed) {
        boolean changed = false;
        if (!Boolean.TRUE.equals(Reflect.getField(abilities, "mayfly"))) {
            set(abilities, "mayfly", true);
            changed = true;
        }
        if (!Boolean.TRUE.equals(Reflect.getField(abilities, "flying"))) {
            set(abilities, "flying", true);
            changed = true;
        }
        Object currentSpeed = Reflect.call(abilities, "getFlyingSpeed");
        if (!(currentSpeed instanceof Number number)
                || Math.abs(number.floatValue() - (float) speed) > 0.0001f) {
            if (!Reflect.invoke(abilities, "setFlyingSpeed", (float) speed)) {
                throw new IllegalStateException("Could not set player flying speed");
            }
            changed = true;
        }
        return changed;
    }

    private void restoreAbilities() {
        AbilityState savedServerState = serverState;
        restore(clientState);
        if (savedServerState != null) {
            Object server = Reflect.call(Reflect.instance(), "getSingleplayerServer");
            if (server != null) {
                scheduleServerRestore(server, savedServerState);
            }
        }
        clientState = null;
        serverState = null;
    }

    private void synchronizeServerFlight(Object server, AbilityState state, double speed) {
        if (server == null || state == null) {
            throw new IllegalStateException("Could not resolve the integrated server flight state");
        }
        if (serverFlightUpdatePending || !needsFlightState(state.abilities(), speed)) {
            return;
        }
        serverFlightUpdatePending = true;
        Runnable update = () -> {
            try {
                if (applyFlightState(state.abilities(), speed)
                        && !Reflect.invoke(state.owner(), "onUpdateAbilities")) {
                    throw new IllegalStateException("Could not synchronize single-player flight abilities");
                }
            } catch (Throwable error) {
                if (enabled) {
                    fail(error);
                } else {
                    Bl.reportFailure(name, error);
                }
            } finally {
                serverFlightUpdatePending = false;
            }
        };
        if (!Reflect.invoke(server, "execute", update)) {
            serverFlightUpdatePending = false;
            throw new IllegalStateException("Could not schedule single-player flight ability update");
        }
    }

    private boolean needsFlightState(Object abilities, double speed) {
        if (!Boolean.TRUE.equals(Reflect.getField(abilities, "mayfly"))
                || !Boolean.TRUE.equals(Reflect.getField(abilities, "flying"))) {
            return true;
        }
        Object currentSpeed = Reflect.call(abilities, "getFlyingSpeed");
        return !(currentSpeed instanceof Number number)
                || Math.abs(number.floatValue() - (float) speed) > 0.0001f;
    }

    private void scheduleServerRestore(Object server, AbilityState state) {
        Runnable restore = () -> {
            try {
                if (restore(state) && !Reflect.invoke(state.owner(), "onUpdateAbilities")) {
                    throw new IllegalStateException("Could not restore server flight abilities");
                }
            } catch (Throwable error) {
                Bl.reportFailure(name + " restore", error);
            }
        };
        if (!Reflect.invoke(server, "execute", restore)) {
            throw new IllegalStateException("Could not schedule server flight ability restoration");
        }
    }

    private boolean restore(AbilityState state) {
        if (state == null) {
            return false;
        }
        boolean changed = false;
        if (!Boolean.valueOf(state.mayfly()).equals(Reflect.getField(state.abilities(), "mayfly"))) {
            set(state.abilities(), "mayfly", state.mayfly());
            changed = true;
        }
        if (!Boolean.valueOf(state.flying()).equals(Reflect.getField(state.abilities(), "flying"))) {
            set(state.abilities(), "flying", state.flying());
            changed = true;
        }
        Object speed = Reflect.call(state.abilities(), "getFlyingSpeed");
        if (!(speed instanceof Number number) || Math.abs(number.floatValue() - state.speed()) > 0.0001f) {
            if (!Reflect.invoke(state.abilities(), "setFlyingSpeed", state.speed())) {
                throw new IllegalStateException("Could not restore player flying speed");
            }
            changed = true;
        }
        return changed;
    }

    private boolean pressed(Object playerInput, String accessor) {
        Object value = playerInput == null ? null : Reflect.call(playerInput, accessor);
        if (!(value instanceof Boolean pressed)) {
            throw new IllegalStateException("Could not read flight key " + accessor);
        }
        return pressed;
    }

    private void set(Object target, String field, boolean value) {
        if (!Reflect.setField(target, field, value)) {
            throw new IllegalStateException("Could not update player ability " + field);
        }
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.getField(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vec, axis);
        }
        if (!(value instanceof Number number)) {
            throw new IllegalStateException("Could not read flight movement component " + axis);
        }
        return number.doubleValue();
    }
}
