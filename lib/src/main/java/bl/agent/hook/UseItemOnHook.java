package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class UseItemOnHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        for (MethodNode method : Hooks.find(node, Descriptors.USE_ITEM_ON)) {
            InsnList list = new InsnList();
            for (int slot = 0; slot < 4; slot++) {
                list.add(new VarInsnNode(Opcodes.ALOAD, slot));
            }
            list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "useItemOn",
                    "(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)V", false));
            method.instructions.insert(list);
        }
    }
}
