package bl.module.movement;

import bl.module.Category;
import bl.module.Module;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.item.MaceItem;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.shape.VoxelShape;
import net.minecraft.world.World;

public final class NoFall extends Module {

    public static NoFall INSTANCE;

    private static final double LOOKAHEAD = 5.0;
    private static final int SOFT_TIMEOUT = 15;
    private static final int HARD_TIMEOUT = 40;
    private static final int DUP_LIMIT = 12;
    private static final double DUPLICATE_DISTANCE_SQUARED = 0.25;
    private static final ThreadLocal<Boolean> replacementPacket = new ThreadLocal<>();

    private enum Step { IDLE, SUPPRESS }

    private Step step = Step.IDLE;
    private double safeY = Double.NEGATIVE_INFINITY;
    private int suppressTicks;
    private int duplicateSetbacks;
    private boolean hasLastSetback;
    private double lastX;
    private double lastY;
    private double lastZ;
    private double lastPacketX;
    private double lastPacketY;
    private double lastPacketZ;
    private boolean hasLastPacketPosition;
    private boolean restoreJumpKey;
    private boolean wasSprinting;
    private float lastHealth = -1.0F;

    public NoFall() {
        super("NoFall", Category.MOVEMENT);
        INSTANCE = this;
    }

    @Override
    protected void onEnable() {
        reset();
        restoreJumpKey = false;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player != null) {
            safeY = mc.player.getY();
            lastHealth = mc.player.getHealth();
        }
    }

    @Override
    protected void onDisable() {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (restoreJumpKey && mc.options != null) {
            mc.options.jumpKey.setPressed(false);
        }
        restoreJumpKey = false;
        reset();
        safeY = Double.NEGATIVE_INFINITY;
        lastHealth = -1.0F;
    }

    private void reset() {
        step = Step.IDLE;
        suppressTicks = 0;
        duplicateSetbacks = 0;
        hasLastSetback = false;
        hasLastPacketPosition = false;
        wasSprinting = false;
    }

    public boolean intercept() {
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientPlayerEntity player = mc.player;
        if (!enabled || replacementPacket.get() == Boolean.TRUE || step != Step.SUPPRESS
                || player == null || mc.world == null || exempt(player)) {
            return false;
        }
        lastPacketX = player.getX();
        lastPacketY = player.getY();
        lastPacketZ = player.getZ();
        hasLastPacketPosition = true;
        return true;
    }

    public static boolean beginReplacementPacket() {
        if (replacementPacket.get() == Boolean.TRUE) {
            return false;
        }
        replacementPacket.set(true);
        return true;
    }

    public static void endReplacementPacket() {
        replacementPacket.remove();
    }

    public void onSetback(double x, double y, double z) {
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientPlayerEntity player = mc.player;
        if (!enabled || player == null || step != Step.SUPPRESS || !hasLastPacketPosition
                || distanceSquared(lastPacketX, lastPacketY, lastPacketZ, x, y, z) >= 16.0) {
            return;
        }

        if (hasLastSetback
                && distanceSquared(lastX, lastY, lastZ, x, y, z) < DUPLICATE_DISTANCE_SQUARED) {
            duplicateSetbacks++;
        } else {
            duplicateSetbacks = 0;
        }
        hasLastSetback = true;
        lastX = x;
        lastY = y;
        lastZ = z;

        if (duplicateSetbacks > DUP_LIMIT && suppressTicks > 30) {
            reset();
            safeY = y;
            return;
        }

        player.setPosition(x, y, z);
        player.fallDistance = 0.0F;
        player.setOnGround(true);
        safeY = y;
        if (!mc.options.jumpKey.isPressed()) {
            mc.options.jumpKey.setPressed(true);
            restoreJumpKey = true;
        }
        if (wasSprinting) {
            player.setSprinting(true);
        }
        reset();
    }

    @Override
    protected void onTick() {
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.world == null) {
            reset();
            safeY = Double.NEGATIVE_INFINITY;
            lastHealth = -1.0F;
            return;
        }

        if (restoreJumpKey) {
            mc.options.jumpKey.setPressed(false);
            restoreJumpKey = false;
        }

        float health = player.getHealth();
        if (lastHealth >= 0.0F && health < lastHealth - 0.01F) {
            reset();
            safeY = player.getY();
        }
        lastHealth = health;

        if (player.getY() < -70.0 && !surfaceWithin(mc.world, player, LOOKAHEAD)) {
            reset();
            safeY = player.getY();
            return;
        }

        if (exempt(player)) {
            safeY = player.getY();
            reset();
            return;
        }

        if (player.getY() > safeY) {
            safeY = player.getY();
            if (step == Step.IDLE) {
                suppressTicks = 0;
            }
        }

        switch (step) {
            case IDLE -> {
                double safeFallDistance = player.getAttributeValue(EntityAttributes.SAFE_FALL_DISTANCE);
                boolean unsafe = player.getY() <= safeY - safeFallDistance;
                if (unsafe && player.getVelocity().y <= 0.0
                        && surfaceWithin(mc.world, player, LOOKAHEAD)) {
                    wasSprinting = player.isSprinting();
                    player.fallDistance = 0.0F;
                    suppressTicks = 0;
                    duplicateSetbacks = 0;
                    hasLastSetback = false;
                    hasLastPacketPosition = false;
                    step = Step.SUPPRESS;
                }
            }
            case SUPPRESS -> {
                player.fallDistance = 0.0F;
                suppressTicks++;

                if (player.getVelocity().y > 0.1) {
                    safeY = player.getY();
                    reset();
                    return;
                }

                if (suppressTicks > SOFT_TIMEOUT && player.isOnGround() && !hasLastSetback) {
                    safeY = player.getY();
                    suppressTicks = 0;
                }

                if (suppressTicks > HARD_TIMEOUT) {
                    safeY = player.getY();
                    reset();
                }
            }
        }
    }

    private static boolean surfaceWithin(World world, ClientPlayerEntity player, double lookahead) {
        Box box = player.getBoundingBox();
        int minX = MathHelper.floor(box.minX);
        int maxX = MathHelper.floor(box.maxX - 1.0E-7);
        int minZ = MathHelper.floor(box.minZ);
        int maxZ = MathHelper.floor(box.maxZ - 1.0E-7);
        int feetY = MathHelper.floor(box.minY);
        int maxDepth = MathHelper.ceil(lookahead);
        BlockPos.Mutable pos = new BlockPos.Mutable();

        for (int y = 0; y <= maxDepth; y++) {
            for (int x = minX; x <= maxX; x++) {
                for (int z = minZ; z <= maxZ; z++) {
                    pos.set(x, feetY - y, z);
                    VoxelShape shape = world.getBlockState(pos).getCollisionShape(world, pos);
                    if (!shape.isEmpty()) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private static boolean exempt(ClientPlayerEntity player) {
        return player.isTouchingWater() || player.isClimbing() || player.isGliding()
                || player.hasVehicle()
                || player.hasStatusEffect(StatusEffects.SLOW_FALLING)
                || player.hasStatusEffect(StatusEffects.LEVITATION)
                || player.getAbilities().flying
                || player.getMainHandStack().getItem() instanceof MaceItem;
    }

    private static double distanceSquared(
            double x1, double y1, double z1, double x2, double y2, double z2) {
        double dx = x1 - x2;
        double dy = y1 - y2;
        double dz = z1 - z2;
        return dx * dx + dy * dy + dz * dz;
    }
}
