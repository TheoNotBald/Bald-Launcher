package bl.agent.hook;

import java.util.ArrayList;
import java.util.List;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

final class Hooks {

    private Hooks() {
    }

    static List<MethodNode> find(ClassNode node, String[][] spec) {
        List<MethodNode> found = new ArrayList<>();
        for (MethodNode method : node.methods) {
            if ((method.access & (Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE)) != 0) {
                continue;
            }
            for (String[] candidate : spec) {
                if ((method.name.equals(candidate[0]) && method.desc.equals(candidate[2]))
                    || (method.name.equals(candidate[1]) && method.desc.equals(candidate[3]))) {
                    found.add(method);
                    break;
                }
            }
        }
        return found;
    }

    static List<MethodNode> findRequired(ClassNode node, String[][] spec, String description) {
        List<MethodNode> found = find(node, spec);
        if (found.isEmpty()) {
            throw new IllegalStateException("Could not locate " + description + " in " + node.name);
        }
        return found;
    }
}
