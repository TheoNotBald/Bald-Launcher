package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FrameNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LabelNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class PacketHook implements ClassHook {

    private final boolean listener;
    private final String[][] spec;

    public PacketHook(boolean listener) {
        this.listener = listener;
        this.spec = listener ? Descriptors.LISTENER_SEND : Descriptors.CONNECTION_SEND;
    }

    @Override
    public void apply(ClassNode node) {
        String entry = listener ? "onSendFromListener" : "onSendFromConnection";
        for (MethodNode method : Hooks.find(node, spec)) {
            InsnList list = new InsnList();
            list.add(new VarInsnNode(Opcodes.ALOAD, 0));
            list.add(new VarInsnNode(Opcodes.ALOAD, 1));
            list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", entry,
                    "(Ljava/lang/Object;Ljava/lang/Object;)Z", false));
            LabelNode label = new LabelNode();
            list.add(new JumpInsnNode(Opcodes.IFEQ, label));
            list.add(new InsnNode(Opcodes.RETURN));
            list.add(label);
            list.add(new FrameNode(Opcodes.F_SAME, 0, null, 0, null));
            method.instructions.insert(list);
        }
    }
}
