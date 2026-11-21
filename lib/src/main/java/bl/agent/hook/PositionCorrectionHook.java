package bl.agent.hook;

import java.util.List;

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
        List<MethodNode> handlers = Hooks.findByDescriptor(node, Descriptors.PLAYER_POSITION_LOOK);
        if (handlers.isEmpty()) {
            System.out.println("[Bald Agent] position correction hook skipped: no handler in " + node.name);
            return;
        }
        for (MethodNode method : handlers) {
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
                System.out.println("[Bald Agent] position correction hook skipped: "
                        + method.name + " has no normal return");
            }
        }
    }
}
