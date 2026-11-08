package bl.mc;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class RuntimeMappings {

    private static final Map<String, String[]> classes = new HashMap<>();
    private static final Map<String, String> namedClasses = new HashMap<>();
    private static final Map<String, List<String[]>> methods = new HashMap<>();
    private static final Map<String, List<String[]>> fields = new HashMap<>();

    private static volatile int namespace;
    private static volatile ClassLoader gameLoader;

    static {
        load();
    }

    private RuntimeMappings() {
    }

    public static void configure(int runtimeNamespace, ClassLoader loader) {
        namespace = runtimeNamespace;
        if (loader != null) {
            gameLoader = loader;
        }
    }

    public static int namespace() {
        return namespace;
    }

    public static ClassLoader gameLoader() {
        return gameLoader;
    }

    public static String className(String name) {
        String internalName = name.replace('.', '/');
        String[] aliases = classes.get(internalName);
        if (aliases == null) {
            String named = namedClasses.get(internalName);
            return named == null ? internalName : runtimeClassName(classes.get(named));
        }
        return runtimeClassName(aliases);
    }

    public static boolean matchesClass(Class<?> type, String namedInternalName) {
        if (type == null) {
            return false;
        }
        String actualName = type.getName().replace('.', '/');
        String expectedName = namedInternalName.replace('.', '/');
        String[] aliases = classes.get(expectedName);
        if (aliases == null) {
            return actualName.equals(expectedName);
        }
        return actualName.equals(aliases[namespace + 1]);
    }

    public static List<String> memberNames(String ownerName, String name, boolean field) {
        String internalOwner = ownerName.replace('.', '/');
        String namedOwner = namedClasses.getOrDefault(internalOwner, internalOwner);
        Map<String, List<String[]>> mappings = field ? fields : methods;
        List<String[]> aliases = mappings.get(namedOwner + "#" + name);
        if (aliases == null) {
            return List.of(name);
        }
        Set<String> names = new LinkedHashSet<>();
        for (String[] mapping : aliases) {
            names.add(mapping[namespace]);
        }
        names.add(name);
        for (String[] mapping : aliases) {
            names.add(mapping[namespace == 0 ? 1 : 0]);
            names.add(mapping[2]);
        }
        return new ArrayList<>(names);
    }

    private static String runtimeClassName(String[] aliases) {
        if (aliases == null) {
            return "";
        }
        return aliases[namespace + 1];
    }

    private static void load() {
        InputStream resource = RuntimeMappings.class.getResourceAsStream("/bl/agent/runtime-mappings.tsv");
        if (resource == null) {
            throw new ExceptionInInitializerError("Missing generated Minecraft runtime mappings");
        }
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(resource, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String[] parts = line.split("\t", -1);
                if (parts.length == 0) {
                    continue;
                }
                if (parts[0].equals("C") && parts.length == 4) {
                    String namedName = parts[1];
                    String[] aliases = { namedName, parts[2], parts[3] };
                    classes.put(namedName, aliases);
                    namedClasses.put(namedName, namedName);
                    namedClasses.put(parts[2], namedName);
                    namedClasses.put(parts[3], namedName);
                } else if ((parts[0].equals("M") || parts[0].equals("F")) && parts.length == 5) {
                    Map<String, List<String[]>> mappings = parts[0].equals("F") ? fields : methods;
                    mappings.computeIfAbsent(parts[1] + "#" + parts[2], ignored -> new ArrayList<>())
                            .add(new String[] { parts[3], parts[4], parts[2] });
                }
            }
        } catch (IOException error) {
            throw new ExceptionInInitializerError(error);
        }
    }
}
