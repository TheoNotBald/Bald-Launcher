package bl.agent.hook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import bl.agent.Descriptors;

class MovementHooksTest {

    @Test
    void insertsClientTickCallback() {
        MethodNode method = method(Descriptors.MINECRAFT[0]);
        ClassNode node = new ClassNode();
        node.methods.add(method);

        new TickHook().apply(node);

        MethodInsnNode preTick = (MethodInsnNode) method.instructions.getFirst();
        assertEquals("bl/Bl", preTick.owner);
        assertEquals("tick", preTick.name);
        AbstractInsnNode returnInsn = method.instructions.getLast();
        assertEquals(Opcodes.RETURN, returnInsn.getOpcode());
        MethodInsnNode postTick = (MethodInsnNode) returnInsn.getPrevious();
        assertEquals("bl/Bl", postTick.owner);
        assertEquals("postTick", postTick.name);
    }

    @Test
    void insertsCallbackBeforeEveryNormalReturn() {
        String[] descriptor = Descriptors.MINECRAFT[0];
        MethodNode method = new MethodNode(Opcodes.ACC_PUBLIC, descriptor[0], descriptor[2], null, null);
        method.instructions.add(new InsnNode(Opcodes.RETURN));
        method.instructions.add(new InsnNode(Opcodes.RETURN));
        ClassNode node = new ClassNode();
        node.methods.add(method);

        new TickHook().apply(node);

        int callbacks = 0;
        for (AbstractInsnNode instruction : method.instructions) {
            if (instruction instanceof MethodInsnNode invocation && invocation.name.equals("postTick")
                    && invocation.owner.equals("bl/Bl")) {
                callbacks++;
                assertEquals(Opcodes.RETURN, instruction.getNext().getOpcode());
            }
        }
        assertEquals(2, callbacks);
    }

    @Test
    void clientTickHookFailsWhenTargetIsMissing() {
        assertThrows(IllegalStateException.class, () -> new TickHook().apply(new ClassNode()));
    }

    @Test
    void insertsSendPositionCallback() {
        MethodNode method = method(Descriptors.SEND_POSITION[0]);
        ClassNode node = new ClassNode();
        node.methods.add(method);

        new SendPositionHook().apply(node);

        MethodInsnNode callback = (MethodInsnNode) method.instructions.getFirst();
        assertEquals("bl/Bl", callback.owner);
        assertEquals("onSendPosition", callback.name);
    }

    @Test
    void sendPositionHookFailsWhenTargetIsMissing() {
        assertThrows(IllegalStateException.class, () -> new SendPositionHook().apply(new ClassNode()));
    }

    private static MethodNode method(String[] descriptor) {
        MethodNode method = new MethodNode(Opcodes.ACC_PUBLIC, descriptor[0], descriptor[2], null, null);
        method.instructions.add(new InsnNode(Opcodes.RETURN));
        return method;
    }
}
