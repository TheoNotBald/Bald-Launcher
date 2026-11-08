package bl.agent.hook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodNode;

import bl.agent.Descriptors;

class RenderLevelHookTest {

    @Test
    void failsWhenRenderMethodIsNotFound() {
        ClassNode node = new ClassNode();
        node.name = "net/minecraft/client/renderer/LevelRenderer";

        assertThrows(IllegalStateException.class, () -> new RenderLevelHook().apply(node));
    }

    @Test
    void insertsOverlayAtRenderMethodEntry() {
        String[] renderMethod = Descriptors.RENDER_LEVEL[0];
        ClassNode node = new ClassNode();
        node.name = "net/minecraft/client/renderer/LevelRenderer";
        MethodNode method = new MethodNode(Opcodes.ACC_PUBLIC, renderMethod[0], renderMethod[2], null, null);
        method.instructions.add(new org.objectweb.asm.tree.InsnNode(Opcodes.RETURN));
        node.methods.add(method);

        new RenderLevelHook().apply(node);

        var first = method.instructions.getFirst();
        assertEquals(Opcodes.ALOAD, first.getOpcode());
        assertEquals(Opcodes.INVOKESTATIC, first.getNext().getOpcode());
        var overlay = (org.objectweb.asm.tree.MethodInsnNode) first.getNext();
        assertEquals("bl/Bl", overlay.owner);
        assertEquals("renderLevel", overlay.name);
    }
}
