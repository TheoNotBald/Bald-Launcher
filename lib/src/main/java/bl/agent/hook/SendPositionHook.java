package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class SendPositionHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        var methods = Hooks.find(node, Descriptors.SEND_POSITION);
        if (methods.isEmpty()) {
            throw new IllegalStateException("Could not locate LocalPlayer.sendPosition");
        }
        for (MethodNode method : methods) {
            InsnList list = new InsnList();
            list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "onSendPosition", "()V", false));
            method.instructions.insert(list);
        }
    }
}
