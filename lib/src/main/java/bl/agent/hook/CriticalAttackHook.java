package bl.agent.hook;

import java.util.ArrayList;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class CriticalAttackHook implements ClassHook {

    private static final String ORIGINAL_ATTACK = "bald$originalAttack";

    @Override
    public void apply(ClassNode node) {
        for (MethodNode method : Hooks.findRequired(
                node, Descriptors.MULTIPLAYER_ATTACK, "MultiPlayerGameMode.attack")) {
            MethodNode original = new MethodNode(Opcodes.ASM9, method.access, method.name, method.desc,
                    method.signature, method.exceptions.toArray(String[]::new));
            method.accept(original);
            original.name = ORIGINAL_ATTACK;
            original.access = (original.access & ~(Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED))
                    | Opcodes.ACC_PRIVATE | Opcodes.ACC_SYNTHETIC;
            node.methods.add(original);

            method.instructions.clear();
            method.tryCatchBlocks = new ArrayList<>();
            method.localVariables = null;
            method.visibleLocalVariableAnnotations = null;
            method.invisibleLocalVariableAnnotations = null;
            method.instructions.add(new VarInsnNode(Opcodes.ALOAD, 0));
            method.instructions.add(new VarInsnNode(Opcodes.ALOAD, 1));
            method.instructions.add(new VarInsnNode(Opcodes.ALOAD, 2));
            method.instructions.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "attackIntercept",
                    "(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)V", false));
            method.instructions.add(new InsnNode(Opcodes.RETURN));
            method.maxStack = 3;
            method.maxLocals = 3;
        }
    }
}
