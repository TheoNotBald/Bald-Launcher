package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class AntiWeb extends Module {

    private final Setting escapeSpeed = setting(Setting.decimal("Escape speed", 0.4, 0.1, 0.8));

    public AntiWeb() {
        super("AntiWeb", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        Object world = Reflect.world();
        if (player == null || world == null) {
            return;
        }
        Object blockPos = Types.find("net/minecraft/core/BlockPos");
        Object pos = Reflect.call(blockPos, "containing",
                Reflect.call(player, "getX"), Reflect.call(player, "getY"), Reflect.call(player, "getZ"));
        Object state = Reflect.call(world, "getBlockState", pos);
        Object block = Reflect.call(state, "getBlock");
        if (!Types.isInstanceOf(block, "net/minecraft/world/level/block/CobwebBlock")) {
            return;
        }
        Object motion = Reflect.call(player, "getDeltaMovement");
        if (motion == null || !Reflect.invoke(player, "setDeltaMovement",
                component(motion, "x") * escapeSpeed.getDouble(),
                Math.max(component(motion, "y"), 0.0),
                component(motion, "z") * escapeSpeed.getDouble())) {
            throw new IllegalStateException("Could not escape cobweb movement slowdown");
        }
    }

    @Override
    protected boolean runsAfterVanillaTick() {
        return true;
    }

    private double component(Object vec, String axis) {
        Object value = Reflect.call(vec, axis);
        if (!(value instanceof Number)) {
            value = Reflect.getField(vec, axis);
        }
        if (!(value instanceof Number number)) {
            throw new IllegalStateException("Could not read movement " + axis);
        }
        return number.doubleValue();
    }
}
