package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class GameRenderHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        for (MethodNode method : Hooks.find(node, Descriptors.GAME_RENDER)) {
            for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                if (insn.getOpcode() == Opcodes.RETURN) {
                    InsnList list = new InsnList();
                    list.add(new VarInsnNode(Opcodes.ALOAD, 0));
                    list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "renderScreen",
                            "(Ljava/lang/Object;)V", false));
                    method.instructions.insertBefore(insn, list);
                }
            }
        }
    }
}
