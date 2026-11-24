package bl.agent;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;

/**
 * Stages the bundled GLFW 3.4 native before the game loads LWJGL's GLFW.
 *
 * <p>Minecraft 1.21.11 pins LWJGL 3.3.3, whose GLFW is 3.3.x and silently
 * ignores {@code GLFW_MOUSE_PASSTHROUGH}; the Java binding already exposes the
 * attribute, so only the DLL has to change. {@code org.lwjgl.librarypath} takes
 * priority over {@code java.library.path}, and premain runs long before the
 * game's window is created, so the override is in place for the first native
 * load. Any existing library path is preserved as a fallback.</p>
 */
public final class GlfwProvisioner {

    private static final String RESOURCE = "/bl/native/glfw.dll";
    private static final String PROPERTY = "org.lwjgl.librarypath";

    private GlfwProvisioner() {
    }

    public static void provision() {
        if (!System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win")) {
            return;
        }
        try (InputStream source = GlfwProvisioner.class.getResourceAsStream(RESOURCE)) {
            if (source == null) {
                System.out.println("[Bald Agent] This build has no bundled GLFW native");
                return;
            }
            Path directory = Paths.get(System.getProperty("java.io.tmpdir"), "bald-glfw-3.4");
            Files.createDirectories(directory);
            Path target = directory.resolve("glfw.dll");
            byte[] bytes = source.readAllBytes();
            if (!Files.exists(target) || Files.size(target) != bytes.length) {
                Files.write(target, bytes);
            }
            String path = directory.toAbsolutePath().toString();
            String existing = System.getProperty(PROPERTY);
            System.setProperty(PROPERTY, existing == null || existing.isEmpty()
                    ? path
                    : path + File.pathSeparator + existing);
            System.out.println("[Bald Agent] Bundled GLFW 3.4 native staged at " + path);
        } catch (Throwable t) {
            System.err.println("[Bald Agent] Could not stage the bundled GLFW native: " + t);
        }
    }
}
