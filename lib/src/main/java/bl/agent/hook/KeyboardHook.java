package bl.agent.hook;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import bl.agent.ClassHook;
import bl.agent.Descriptors;

public final class KeyboardHook implements ClassHook {

    @Override
    public void apply(ClassNode node) {
        for (MethodNode method : Hooks.find(node, Descriptors.KEYBOARD_KEY_PRESS)) {
            int namespace = namespace(node, method);
            if (namespace < 0) {
                continue;
            }
            int eventLocal = -1;
            int actionLocal = -1;
            int local = (method.access & Opcodes.ACC_STATIC) == 0 ? 1 : 0;
            String eventClass = Descriptors.CLASS_KEY_EVENT_KEY[namespace];
            for (Type argument : Type.getArgumentTypes(method.desc)) {
                if (argument.getSort() == Type.INT && actionLocal < 0) {
                    actionLocal = local;
                }
                if (argument.getSort() == Type.OBJECT && argument.getInternalName().equals(eventClass)) {
                    eventLocal = local;
                }
                local += argument.getSize();
            }
            if (eventLocal < 0 || actionLocal < 0 || Descriptors.KEY_EVENT_KEY.length == 0) {
                continue;
            }
            String[] keyMethod = Descriptors.KEY_EVENT_KEY[0];
            InsnList list = new InsnList();
            list.add(new VarInsnNode(Opcodes.ALOAD, 0));
            list.add(new VarInsnNode(Opcodes.ALOAD, eventLocal));
            list.add(new MethodInsnNode(Opcodes.INVOKEVIRTUAL, eventClass,
                    keyMethod[namespace], keyMethod[namespace + 2], false));
            list.add(new VarInsnNode(Opcodes.ILOAD, actionLocal));
            list.add(new org.objectweb.asm.tree.LdcInsnNode(namespace));
            list.add(new MethodInsnNode(Opcodes.INVOKESTATIC, "bl/Bl", "onKey",
                    "(Ljava/lang/Object;III)V", false));
            method.instructions.insert(list);
        }
    }

    private static int namespace(ClassNode owner, MethodNode method) {
        if (owner.name.equals(Descriptors.CLASS_KEYBOARD_KEY_PRESS[0])) {
            return 0;
        }
        if (owner.name.equals(Descriptors.CLASS_KEYBOARD_KEY_PRESS[1])) {
            return 1;
        }
        for (String[] candidate : Descriptors.KEYBOARD_KEY_PRESS) {
            if (method.name.equals(candidate[0]) && method.desc.equals(candidate[2])) {
                return 0;
            }
            if (method.name.equals(candidate[1]) && method.desc.equals(candidate[3])) {
                return 1;
            }
        }
        return -1;
    }
}