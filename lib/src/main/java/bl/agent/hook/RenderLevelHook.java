package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;
import java.util.List;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class RenderLevelHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        List<MethodNode> renderMethods = Hooks.find(node, Descriptors.RENDER_LEVEL);
        if (renderMethods.isEmpty()) {
            throw new IllegalStateException("Could not locate LevelRenderer.renderLevel");
        }
        for (MethodNode method : renderMethods) {
            InsnList callback = new InsnList();
            callback.add(new VarInsnNode(Opcodes.ALOAD, 0));
            callback.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "renderLevel",
                    "(Ljava/lang/Object;)V", false));
            method.instructions.insert(callback);
        }
    }
}
