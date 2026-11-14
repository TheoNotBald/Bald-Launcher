package bl.agent;

import java.lang.instrument.ClassFileTransformer;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.security.ProtectionDomain;
import java.util.ArrayList;
import java.util.List;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

import bl.agent.hook.AttackHook;
import bl.agent.hook.CriticalAttackHook;
import bl.agent.hook.KeyboardHook;
import bl.agent.hook.ReceiveMotionHook;
import bl.agent.hook.RenderLevelHook;
import bl.agent.hook.SendPositionHook;
import bl.agent.hook.TickHook;
import bl.mc.RuntimeMappings;

public final class Patcher implements ClassFileTransformer {

    private static final class Entry {
        final String[] names;
        final ClassHook hook;

        Entry(String[] names, ClassHook hook) {
            this.names = names;
            this.hook = hook;
        }
    }

    private final List<Entry> entries = new ArrayList<>();
    private ClassLoader exposedLoader;
    private ClassLoader configuredLoader;

    public void register(String[] names, ClassHook hook) {
        entries.add(new Entry(names, hook));
    }

    public boolean isEmpty() {
        return entries.isEmpty();
    }

    @Override
    public byte[] transform(ClassLoader loader, String className, Class<?> redefined,
            ProtectionDomain domain, byte[] bytes) {
        if (className == null || bytes == null || entries.isEmpty()) {
            return null;
        }
        ClassHook hook = null;
        List<ClassHook> matchingHooks = new ArrayList<>();
        int runtimeNamespace = 0;
        for (Entry entry : entries) {
            for (int index = 0; index < entry.names.length; index++) {
                if (entry.names[index].equals(className)) {
                    if (hook == null) {
                        hook = entry.hook;
                    }
                    matchingHooks.add(entry.hook);
                    runtimeNamespace = index == 1 ? 1 : 0;
                    break;
                }
            }
        }
        if (matchingHooks.isEmpty()) {
            return null;
        }
        RuntimeMappings.configure(runtimeNamespace, loader);
        try {
            initializeAgentInGameLoader(loader, runtimeNamespace);
        } catch (Throwable error) {
            System.err.println("[Bald Agent] Could not initialize agent in the game classloader");
            error.printStackTrace(System.err);
            return null;
        }
        boolean keyboardHook = hook instanceof KeyboardHook;
        boolean renderLevelHook = hook instanceof RenderLevelHook;
        boolean sendPositionHook = hook instanceof SendPositionHook;
        boolean tickHook = hook instanceof TickHook;
        boolean motionHook = hook instanceof ReceiveMotionHook;
        boolean attackHook = hook instanceof AttackHook;
        boolean criticalAttackHook = hook instanceof CriticalAttackHook;
        if (Boolean.getBoolean("lib.debug")) {
            System.out.println("lib: " + className.replace('/', '.'));
        }
        try {
            ClassNode node = new ClassNode();
            new ClassReader(bytes).accept(node, ClassReader.EXPAND_FRAMES);
            int matchedMethods = 0;
            if (keyboardHook) {
                for (MethodNode method : node.methods) {
                    for (String[] candidate : Descriptors.KEYBOARD_KEY_PRESS) {
                        if ((method.name.equals(candidate[0]) && method.desc.equals(candidate[2]))
                                || (method.name.equals(candidate[1]) && method.desc.equals(candidate[3]))) {
                            matchedMethods++;
                            break;
                        }
                    }

                }
                System.out.println("[Bald Agent] KeyboardHandler loaded as " + className
                        + "; matched key methods: " + matchedMethods);
            }
            for (ClassHook matchingHook : matchingHooks) {
                matchingHook.apply(node);
            }
            if (matchingHooks.size() > 1) {
                System.out.println("[Bald Agent] Applied " + matchingHooks.size()
                        + " hooks to " + className);
            }
            if (keyboardHook) {
                System.out.println("[Bald Agent] Keyboard hook applied to " + matchedMethods + " method(s)");
            }
            if (renderLevelHook) {
                System.out.println("[Bald Agent] LevelRenderer render hook applied");
            }
            if (sendPositionHook) {
                System.out.println("[Bald Agent] LocalPlayer send-position hook applied");
            }
            if (tickHook) {
                System.out.println("[Bald Agent] Minecraft client tick hook applied");
            }
            if (motionHook) {
                System.out.println("[Bald Agent] incoming velocity hook applied");
            }
            if (attackHook) {
                System.out.println("[Bald Agent] player attack hook applied");
            }
            if (criticalAttackHook) {
                System.out.println("[Bald Agent] game-mode attack hook applied");
            }
            ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
            node.accept(writer);
            return writer.toByteArray();
        } catch (Throwable t) {
            String hookName = keyboardHook ? "Keyboard"
                    : renderLevelHook ? "LevelRenderer render"
                    : sendPositionHook ? "LocalPlayer send-position"
                    : tickHook ? "Minecraft client tick"
                    : motionHook ? "incoming velocity"
                    : attackHook ? "player attack"
                    : criticalAttackHook ? "game-mode attack"
                    : hook.getClass().getSimpleName();
            System.err.println("[Bald Agent] " + hookName + " hook transformation failed for " + className);
            t.printStackTrace(System.err);
            return null;
        }
    }

    private synchronized void exposeAgentToGameLoader(ClassLoader loader) throws Exception {
        if (loader == null || exposedLoader == loader) {
            return;
        }
        var location = Agent.class.getProtectionDomain().getCodeSource().getLocation();
        Path agentJar = Path.of(location.toURI()).toAbsolutePath().normalize();

        Object delegate = gameDelegate(loader);
        Method addCodeSource = delegate.getClass().getMethod("addCodeSource", Path.class);
        addCodeSource.setAccessible(true);
        addCodeSource.invoke(delegate, agentJar);
        exposedLoader = loader;
        System.out.println("[Bald Agent] Added agent code source to " + loader.getClass().getName());
    }

    private synchronized void initializeAgentInGameLoader(ClassLoader loader, int runtimeNamespace)
            throws Exception {
        if (configuredLoader == loader) {
            return;
        }
        exposeAgentToGameLoader(loader);

        Object delegate = gameDelegate(loader);
        Method loadIntoTarget = delegate.getClass().getMethod("loadIntoTarget", String.class);
        loadIntoTarget.setAccessible(true);

        Class<?> mappings = (Class<?>) loadIntoTarget.invoke(delegate, "bl.mc.RuntimeMappings");
        mappings.getMethod("configure", int.class, ClassLoader.class).invoke(null, runtimeNamespace, loader);
        configuredLoader = loader;
        System.out.println("[Bald Agent] Configured runtime mappings in the game classloader");
    }

    private Object gameDelegate(ClassLoader loader) throws ReflectiveOperationException {
        Field delegateField = loader.getClass().getDeclaredField("delegate");
        delegateField.setAccessible(true);
        return delegateField.get(loader);
    }
}
