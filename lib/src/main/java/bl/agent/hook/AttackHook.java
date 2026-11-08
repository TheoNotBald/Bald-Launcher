package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class AttackHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        for (MethodNode method : Hooks.findRequired(node, Descriptors.PLAYER_ATTACK, "Player.attack")) {
            InsnList list = new InsnList();
            list.add(new VarInsnNode(Opcodes.ALOAD, 0));
            list.add(new VarInsnNode(Opcodes.ALOAD, 1));
            list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "attack",
                    "(Ljava/lang/Object;Ljava/lang/Object;)V", false));
            method.instructions.insert(list);
        }
    }
}
