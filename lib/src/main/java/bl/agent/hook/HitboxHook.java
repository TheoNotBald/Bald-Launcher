package bl.agent.hook;

import java.util.List;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.TypeInsnNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

/**
 * Routes {@code Entity#getBoundingBox} through {@link bl.Bl#hitbox} so the
 * Hitboxes module can expand the returned box without a Mixin runtime.
 *
 * <p>The callback takes the box first and the entity second, which matches the
 * operand stack at {@code ARETURN} after a single {@code ALOAD 0}: the return
 * value stays underneath the receiver and the resulting box remains on top.</p>
 */
public final class HitboxHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        List<MethodNode> methods = Hooks.find(node, Descriptors.ENTITY_BOUNDING_BOX);
        if (methods.isEmpty()) {
            throw new IllegalStateException("Could not locate Entity.getBoundingBox");
        }
        for (MethodNode method : methods) {
            Type returnType = Type.getReturnType(method.desc);
            if (returnType.getSort() != Type.OBJECT) {
                throw new IllegalStateException("Unexpected bounding box return type " + method.desc);
            }
            String box = returnType.getInternalName();
            String descriptor = "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;";
            int patched = 0;
            for (AbstractInsnNode insn = method.instructions.getFirst(); insn != null; insn = insn.getNext()) {
                if (insn.getOpcode() != Opcodes.ARETURN) {
                    continue;
                }
                InsnList callback = new InsnList();
                callback.add(new VarInsnNode(Opcodes.ALOAD, 0));
                callback.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "hitbox",
                        descriptor, false));
                callback.add(new TypeInsnNode(Opcodes.CHECKCAST, box));
                method.instructions.insertBefore(insn, callback);
                patched++;
            }
            if (patched == 0) {
                throw new IllegalStateException("Entity.getBoundingBox has no return point");
            }
        }
    }
}
