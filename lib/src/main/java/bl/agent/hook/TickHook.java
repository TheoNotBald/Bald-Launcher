package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class TickHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        var methods = Hooks.find(node, Descriptors.MINECRAFT);
        if (methods.isEmpty()) {
            throw new IllegalStateException("Could not locate Minecraft.tick");
        }
        for (MethodNode method : methods) {
            InsnList preTick = new InsnList();
            preTick.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "tick", "()V", false));
            method.instructions.insert(preTick);

            int returnCount = 0;
            for (AbstractInsnNode instruction = method.instructions.getFirst();
                    instruction != null; instruction = instruction.getNext()) {
                if (instruction.getOpcode() != Opcodes.RETURN) {
                    continue;
                }
                InsnList postTick = new InsnList();
                postTick.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "postTick", "()V", false));
                method.instructions.insertBefore(instruction, postTick);
                returnCount++;
            }
            if (returnCount == 0) {
                throw new IllegalStateException("Minecraft.tick has no normal return point");
            }
        }
    }
}
