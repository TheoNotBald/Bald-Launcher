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

/**
 * Runs after Player#makeStuckInBlock stores the cobweb movement multiplier.
 * Entity#move consumes that multiplier once and then clears the player's
 * velocity, so clearing it after the vanilla tick can never work.
 */
public final class StuckHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        var methods = Hooks.find(node, Descriptors.PLAYER_MAKE_STUCK);
        if (methods.isEmpty()) {
            throw new IllegalStateException("Could not locate Player.makeStuckInBlock");
        }
        for (MethodNode method : methods) {
            int returns = 0;
            for (AbstractInsnNode instruction = method.instructions.getFirst();
                    instruction != null; instruction = instruction.getNext()) {
                if (instruction.getOpcode() != Opcodes.RETURN) {
                    continue;
                }
                InsnList hook = new InsnList();
                hook.add(new VarInsnNode(Opcodes.ALOAD, 0));
                hook.add(new VarInsnNode(Opcodes.ALOAD, 1));
                hook.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "stuckInBlock",
                        "(Ljava/lang/Object;Ljava/lang/Object;)V", false));
                method.instructions.insertBefore(instruction, hook);
                returns++;
            }
            if (returns == 0) {
                throw new IllegalStateException("Player.makeStuckInBlock has no normal return point");
            }
        }
    }
}