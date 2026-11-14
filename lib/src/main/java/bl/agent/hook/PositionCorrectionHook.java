package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class PositionCorrectionHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        for (MethodNode method : Hooks.findRequired(
                node, Descriptors.PLAYER_POSITION_LOOK, "client player position correction")) {
            boolean injected = false;
            for (var instruction = method.instructions.getFirst(); instruction != null;
                    instruction = instruction.getNext()) {
                if (instruction.getOpcode() != Opcodes.RETURN) {
                    continue;
                }
                InsnList callback = new InsnList();
                callback.add(new MethodInsnNode(
                        Opcodes.INVOKESTATIC, "bl/Bl", "onPositionSetback", "()V", false));
                method.instructions.insertBefore(instruction, callback);
                injected = true;
            }
            if (!injected) {
                throw new IllegalStateException("Position correction handler has no normal return");
            }
        }
    }
}
