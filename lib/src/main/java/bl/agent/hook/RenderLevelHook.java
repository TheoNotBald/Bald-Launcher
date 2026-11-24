package bl.agent.hook;

import java.util.ArrayList;
import java.util.List;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class RenderLevelHook implements ClassHook {

    private static final String MATRIX = "Lorg/joml/Matrix4f;";

    @Override
    public void apply(ClassNode node) {
        List<MethodNode> renderMethods = Hooks.find(node, Descriptors.RENDER_LEVEL);
        if (renderMethods.isEmpty()) {
            throw new IllegalStateException("Could not locate LevelRenderer.renderLevel");
        }
        for (MethodNode method : renderMethods) {
            int[] slots = resolve(method);
            InsnList callback = new InsnList();
            callback.add(new VarInsnNode(Opcodes.ALOAD, 0));
            callback.add(new VarInsnNode(Opcodes.ALOAD, slots[0]));
            callback.add(new VarInsnNode(Opcodes.ALOAD, slots[1]));
            callback.add(new VarInsnNode(Opcodes.ALOAD, slots[2]));
            callback.add(new VarInsnNode(Opcodes.ALOAD, slots[3]));
            callback.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "renderLevel",
                    "(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)V",
                    false));
            method.instructions.insert(callback);
        }
    }

    /**
     * Finds the local slots of the render tick counter, camera, position matrix
     * and projection matrix, so the ESP renderer can reuse the exact matrices
     * and partial tick the frame is rendered with.
     *
     * <p>Names differ between the official and intermediary namespaces, so the
     * arguments are identified by position: the camera is the argument right
     * before the position matrix, the tick counter is the argument two before
     * that (a boolean sits in between).</p>
     */
    private int[] resolve(MethodNode method) {
        Type[] arguments = Type.getArgumentTypes(method.desc);
        int[] slots = new int[arguments.length];
        List<Integer> matrixIndices = new ArrayList<>();
        int slot = 1;
        for (int index = 0; index < arguments.length; index++) {
            slots[index] = slot;
            if (MATRIX.equals(arguments[index].getDescriptor())) {
                matrixIndices.add(index);
            }
            slot += arguments[index].getSize();
        }
        if (matrixIndices.size() < 3) {
            throw new IllegalStateException("Unexpected render signature, no matrices: " + method.desc);
        }
        int firstMatrix = matrixIndices.get(0);
        int cameraIndex = firstMatrix - 1;
        int tickIndex = firstMatrix - 3;
        if (cameraIndex < 0 || tickIndex < 0
                || arguments[cameraIndex].getSort() != Type.OBJECT
                || arguments[tickIndex].getSort() != Type.OBJECT) {
            throw new IllegalStateException("Unexpected render signature, no camera or tick counter: "
                    + method.desc);
        }
        return new int[] {
                slots[tickIndex],
                slots[cameraIndex],
                slots[firstMatrix],
                slots[matrixIndices.get(2)],
        };
    }
}
