package bl.agent.hook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.TypeInsnNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.Descriptors;

class HitboxHookTest {

    @Test
    void wrapsTheReturnedBoxWithTheAgentCallback() {
        String[] spec = Descriptors.ENTITY_BOUNDING_BOX[0];
        ClassNode node = new ClassNode();
        node.name = "net/minecraft/class_1297";
        MethodNode method = new MethodNode(Opcodes.ACC_PUBLIC, spec[1], spec[3], null, null);
        method.instructions.add(new InsnNode(Opcodes.ACONST_NULL));
        method.instructions.add(new InsnNode(Opcodes.ARETURN));
        node.methods.add(method);

        new HitboxHook().apply(node);

        AbstractInsnNode returnInsn = null;
        for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; insn = insn.getNext()) {
            if (insn.getOpcode() == Opcodes.ARETURN) {
                returnInsn = insn;
                break;
            }
        }
        assertNotNull(returnInsn);
        AbstractInsnNode cast = returnInsn.getPrevious();
        AbstractInsnNode call = cast.getPrevious();
        AbstractInsnNode load = call.getPrevious();
        assertInstanceOf(TypeInsnNode.class, cast);
        assertEquals(Opcodes.CHECKCAST, cast.getOpcode());
        assertEquals("net/minecraft/class_238", ((TypeInsnNode) cast).desc);
        assertInstanceOf(MethodInsnNode.class, call);
        assertEquals("bl/Bl", ((MethodInsnNode) call).owner);
        assertEquals("hitbox", ((MethodInsnNode) call).name);
        assertEquals("(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;",
            ((MethodInsnNode) call).desc);
        assertEquals(Opcodes.ALOAD, load.getOpcode());
        assertEquals(0, ((VarInsnNode) load).var);
    }
}
