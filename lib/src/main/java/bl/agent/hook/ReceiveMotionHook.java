package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class ReceiveMotionHook implements ClassHook {

    @Override
    public void apply(org.objectweb.asm.tree.ClassNode node) {
        for (MethodNode method : Hooks.findRequired(
                node, Descriptors.CLIENT_SET_ENTITY_MOTION, "ClientPacketListener.handleSetEntityMotion")) {
            InsnList list = new InsnList();
            list.add(new VarInsnNode(Opcodes.ALOAD, 1));
            list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "onReceiveMotion",
                    "(Ljava/lang/Object;)V", false));
            method.instructions.insert(list);
        }
    }
}
