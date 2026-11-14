package bl.packet;

import bl.Bl;
import bl.event.events.SendPacketEvent;
import bl.mc.Reflect;
import bl.mc.Types;

public final class PacketUtil {

    private static final String MOTION_PACKET = "net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket";

    private PacketUtil() {
    }

    public static boolean send(Object packet) {
        Object connection = Bl.connection();
        if (connection == null || packet == null) {
            return false;
        }
        return Reflect.invoke(connection, "send", packet);
    }

    public static boolean scaleMotion(Object packet, double factor) {
        return scaleMotion(packet, factor, 1.0);
    }

    public static boolean scaleMotion(Object packet, double horizontalFactor, double verticalFactor) {
        if (!Types.isInstanceOf(packet, MOTION_PACKET.replace('.', '/'))) {
            return false;
        }
        try {
            Object movement = Reflect.call(packet, "getVelocity");
            if (movement == null) {
                movement = Reflect.call(packet, "getMovement");
            }
            if (movement == null) {
                throw new NoSuchMethodException("Clientbound motion packet movement");
            }
            double x = component(movement, "x");
            double y = component(movement, "y");
            double z = component(movement, "z");
            Class<?> vectorType = Types.find("net/minecraft/world/phys/Vec3");
            if (vectorType == null) {
                throw new ClassNotFoundException("Minecraft Vec3");
            }
            Object scaled = vectorType.getConstructor(double.class, double.class, double.class)
                    .newInstance(x * horizontalFactor, y * verticalFactor, z * horizontalFactor);
            if (!Reflect.setField(packet, "movement", scaled)
                    && !Reflect.setField(packet, "velocity", scaled)) {
                throw new NoSuchFieldException("Clientbound motion packet movement");
            }
            return true;
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not scale incoming motion packet", error);
        }
    }

    private static double component(Object vector, String axis) throws NoSuchFieldException {
        Object value = Reflect.getField(vector, axis);
        if (!(value instanceof Number)) {
            value = Reflect.call(vector, axis);
        }
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        throw new NoSuchFieldException("Vec3." + axis);
    }

    public static boolean handle(SendPacketEvent event) {
        return event.cancelled;
    }
}
