package bl.agent;

import org.objectweb.asm.tree.ClassNode;

public interface ClassHook {
    void apply(ClassNode node) throws Exception;
}
