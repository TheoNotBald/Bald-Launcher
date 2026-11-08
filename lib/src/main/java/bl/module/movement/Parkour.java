package bl.module.movement;

import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;

public final class Parkour extends Module {

    private boolean jumped;

    public Parkour() {
        super("Parkour", Category.MOVEMENT, true);
    }

    @Override
    protected void onTick() {
        Object player = Reflect.player();
        if (player == null || !Worlds.onGround(player)) {
            jumped = false;
            return;
        }
        Object minecraft = Reflect.instance();
        Object options = Reflect.getField(minecraft, "options");
        Object forwardKey = Reflect.getField(options, "keyUp");
        Object backKey = Reflect.getField(options, "keyDown");
        Object leftKey = Reflect.getField(options, "keyLeft");
        Object rightKey = Reflect.getField(options, "keyRight");
        double forward = (Boolean.TRUE.equals(Reflect.call(forwardKey, "isDown")) ? 1.0 : 0.0)
                - (Boolean.TRUE.equals(Reflect.call(backKey, "isDown")) ? 1.0 : 0.0);
        double strafe = (Boolean.TRUE.equals(Reflect.call(rightKey, "isDown")) ? 1.0 : 0.0)
                - (Boolean.TRUE.equals(Reflect.call(leftKey, "isDown")) ? 1.0 : 0.0);
        if (forward == 0.0 && strafe == 0.0) {
            jumped = false;
            return;
        }
        double yaw = Math.toRadians(Reflect.yaw());
        double x = Worlds.coordinate(player, "getX", "x")
                - Math.sin(yaw) * forward * 0.65 + Math.cos(yaw) * strafe * 0.65;
        double z = Worlds.coordinate(player, "getZ", "z")
                + Math.cos(yaw) * forward * 0.65 + Math.sin(yaw) * strafe * 0.65;
        double y = Worlds.coordinate(player, "getY", "y") - 0.05;
        Class<?> blockPos = bl.mc.Types.find("net/minecraft/core/BlockPos");
        Object pos = blockPos == null ? null : Reflect.call(blockPos, "containing", x, y, z);
        Object world = Reflect.world();
        Object state = Reflect.call(world, "getBlockState", pos);
        if (state == null || pos == null) {
            throw new IllegalStateException("Could not check the block ahead of the player");
        }
        Object shape = Reflect.call(state, "getCollisionShape", world, pos);
        Object empty = Reflect.call(shape, "isEmpty");
        if (pos == null || !Boolean.TRUE.equals(empty)) {
            jumped = false;
            return;
        }
        if (!jumped && !Boolean.TRUE.equals(Reflect.call(player, "isShiftKeyDown"))) {
            if (!Reflect.invoke(player, "jumpFromGround")) {
                throw new IllegalStateException("Could not jump at the edge");
            }
            jumped = true;
        }
    }
}
