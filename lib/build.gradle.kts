import net.fabricmc.tinyremapper.NonClassCopyMode
import net.fabricmc.tinyremapper.TinyRemapper
import net.fabricmc.tinyremapper.TinyUtils
import java.net.URI
import java.util.jar.Attributes
import java.util.jar.JarFile
import java.util.jar.Manifest
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

buildscript {
    repositories {
        mavenCentral()
        maven("https://maven.fabricmc.net/")
    }
    dependencies {
        classpath("net.fabricmc:mapping-io:0.6.1")
        classpath("net.fabricmc:tiny-remapper:0.10.4")
    }
}

plugins {
    java
    id("com.gradleup.shadow") version "8.3.0"
}

group = "bl"
version = "1.0.0"

val mcVersion: String = property("mc_version") as String
val buildDirRef = layout.buildDirectory
val officialTiny = buildDirRef.file("mappings/official.tiny")
val intermediaryTiny = buildDirRef.file("mappings/intermediary.tiny")
val clientJar = buildDirRef.file("client.jar")
val clientNamedJar = buildDirRef.file("client-named.jar")
val shadowJarFile = buildDirRef.file("libs/lib-${version}-all.jar")

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(21)) }
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

repositories {
    mavenCentral()
    maven("https://maven.fabricmc.net/")
    maven("https://libraries.minecraft.net/")
}

dependencies {
    implementation("org.ow2.asm:asm:9.7.1")
    implementation("org.ow2.asm:asm-commons:9.7.1")
    implementation("org.ow2.asm:asm-tree:9.7.1")
    implementation("net.fabricmc:mapping-io:0.6.1")
    implementation("net.fabricmc:tiny-remapper:0.10.4")
    compileOnly("com.mojang:brigadier:1.3.10")

    compileOnly(files(clientNamedJar))
    annotationProcessor(files(clientNamedJar))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

fun fetch(url: String, target: File) {
    target.parentFile.mkdirs()
    URI(url).toURL().openStream().use { input -> target.outputStream().use { input.copyTo(it) } }
}

fun jsonField(text: String, key: String): String? {
    val needle = "\"$key\""
    var index = text.indexOf(needle)
    if (index < 0) return null
    index = text.indexOf(':', index + needle.length)
    if (index < 0) return null
    index++
    while (index < text.length && text[index].isWhitespace()) index++
    if (index >= text.length || text[index] != '"') return null
    val end = text.indexOf('"', index + 1)
    if (end < 0) return null
    return text.substring(index + 1, end)
}

fun typeDescriptor(raw: String, classMap: Map<String, String>): String {
    var depth = 0
    var name = raw
    while (name.endsWith("[]")) {
        depth++
        name = name.removeSuffix("[]")
    }
    val base = when (name) {
        "void" -> "V"
        "boolean" -> "Z"
        "byte" -> "B"
        "char" -> "C"
        "short" -> "S"
        "int" -> "I"
        "long" -> "J"
        "float" -> "F"
        "double" -> "D"
        else -> "L${(classMap[name] ?: name).replace('.', '/')};"
    }
    return "[".repeat(depth) + base
}

fun remapDescriptor(descriptor: String, classMap: Map<String, String>): String =
    Regex("L([^;]+);").replace(descriptor) { match ->
        "L${classMap[match.groupValues[1]] ?: match.groupValues[1]};"
    }

val downloadMappings = tasks.register("downloadMappings") {
    outputs.file(officialTiny)
    doLast {
        val manifestText = URI("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").toURL().readText()
        val manifest = groovy.json.JsonSlurper().parseText(manifestText) as Map<*, *>
        val versions = manifest["versions"] as? List<*> ?: error("Mojang manifest has no versions list")
        val version = versions.filterIsInstance<Map<*, *>>().firstOrNull { it["id"] == mcVersion }
            ?: error("Version $mcVersion not present in manifest")
        val versionUrl = version["url"] as? String ?: error("No metadata url for $mcVersion")

        val versionJson = URI(versionUrl).toURL().readText()
        val versionMetadata = groovy.json.JsonSlurper().parseText(versionJson) as Map<*, *>
        val downloads = versionMetadata["downloads"] as? Map<*, *>
        val mappingsUrl = (downloads?.get("client_mappings") as? Map<*, *>)?.get("url") as? String
        requireNotNull(mappingsUrl) { "No client mappings for $mcVersion" }

        val proguard = buildDirRef.file("mappings/client.proguard").get().asFile
        fetch(mappingsUrl, proguard)

        val classMap = LinkedHashMap<String, String>()
        for (rawLine in proguard.readLines()) {
            if (rawLine.isBlank() || rawLine.startsWith("#")) continue
            if (!rawLine.startsWith("    ") && rawLine.contains(" -> ") && rawLine.endsWith(":")) {
                val body = rawLine.trim().removeSuffix(":")
                val parts = body.split(" -> ")
                if (parts.size == 2) classMap[parts[0]] = parts[1]
            }
        }

        // Group member lines under their owning class.
        val grouped = StringBuilder("tiny\t2\t0\tofficial\tnamed\n")
        var ownerOfficial: String? = null
        for (rawLine in proguard.readLines()) {
            if (rawLine.isBlank() || rawLine.startsWith("#")) continue
            if (!rawLine.startsWith("    ")) {
                if (!rawLine.contains(" -> ") || !rawLine.endsWith(":")) continue
                val parts = rawLine.trim().removeSuffix(":").split(" -> ")
                if (parts.size != 2) continue
                ownerOfficial = parts[1].replace('.', '/')
                grouped.append("c\t").append(ownerOfficial).append('\t').append(parts[0].replace('.', '/')).append('\n')
                continue
            }
            if (ownerOfficial == null) continue
            val body = rawLine.trim()
            val arrow = body.lastIndexOf(" -> ")
            if (arrow < 0) continue
            val original = body.substring(0, arrow)
            val officialName = body.substring(arrow + 4)
            if (original.contains('(')) {
                val left = original.substringBefore('(').replace(Regex("^\\d+:\\d+:"), "")
                val args = original.substringAfter('(').substringBeforeLast(')')
                val namedName = left.substringAfterLast(' ')
                val returnType = left.substringBeforeLast(' ').trim()
                val desc = "(" + args.split(",").filter { it.isNotBlank() }
                    .joinToString("") { typeDescriptor(it.trim(), classMap) } + ")" +
                    typeDescriptor(returnType, classMap)
                grouped.append("\tm\t").append(desc).append('\t').append(officialName)
                    .append('\t').append(namedName).append('\n')
            } else {
                val namedName = original.substringAfterLast(' ')
                val type = original.substringBeforeLast(' ').trim()
                val desc = typeDescriptor(type, classMap)
                grouped.append("\tf\t").append(desc).append('\t').append(officialName)
                    .append('\t').append(namedName).append('\n')
            }
        }
        officialTiny.get().asFile.writeText(grouped.toString())
        proguard.delete()
    }
}

val downloadClient = tasks.register("downloadClient") {
    outputs.file(clientJar)
    doLast {
        val manifestText = URI("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").toURL().readText()
        val manifest = groovy.json.JsonSlurper().parseText(manifestText) as Map<*, *>
        val versions = manifest["versions"] as? List<*> ?: error("Mojang manifest has no versions list")
        val version = versions.filterIsInstance<Map<*, *>>().firstOrNull { it["id"] == mcVersion }
            ?: error("Version $mcVersion not present in manifest")
        val versionUrl = version["url"] as? String ?: error("No metadata url for $mcVersion")
        val versionJson = URI(versionUrl).toURL().readText()
        val versionMetadata = groovy.json.JsonSlurper().parseText(versionJson) as Map<*, *>
        val downloads = versionMetadata["downloads"] as? Map<*, *>
        val clientUrl = (downloads?.get("client") as? Map<*, *>)?.get("url") as? String
        requireNotNull(clientUrl) { "No client download for $mcVersion" }
        fetch(clientUrl, clientJar.get().asFile)
    }
}

val downloadIntermediary = tasks.register("downloadIntermediary") {
    outputs.file(intermediaryTiny)
    doLast {
        val jar = buildDirRef.file("mappings/intermediary.jar").get().asFile
        fetch(
            "https://maven.fabricmc.net/net/fabricmc/intermediary/$mcVersion/intermediary-$mcVersion-v2.jar",
            jar,
        )
        ZipFile(jar).use { zip ->
            val entry = zip.getEntry("mappings/mappings.tiny") ?: error("intermediary jar has no mappings")
            intermediaryTiny.get().asFile.writeText(zip.getInputStream(entry).reader().readText())
        }
        jar.delete()
    }
}

fun remap(input: File, output: File, mappingFile: File, from: String, to: String) {
    val remapper = TinyRemapper.newRemapper()
        .withMappings(TinyUtils.createTinyMappingProvider(mappingFile.toPath(), from, to))
        .renameInvalidLocals(true)
        .rebuildSourceFilenames(true)
        .threads(8)
        .fixPackageAccess(true)
        .build()
    output.parentFile.mkdirs()
    val remappedClasses = HashMap<String, ByteArray>()
    try {
        remapper.readInputsAsync(input.toPath())
        remapper.apply { name, bytes -> remappedClasses[name] = bytes }
    } finally {
        remapper.finish()
    }
    ZipOutputStream(output.outputStream().buffered()).use { zip ->
        for ((name, bytes) in remappedClasses) {
            val entryName = if (name.endsWith(".class")) name else "$name.class"
            zip.putNextEntry(ZipEntry(entryName))
            zip.write(bytes)
            zip.closeEntry()
        }
        ZipFile(input).use { source ->
            val entries = source.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                if (entry.isDirectory || entry.name.endsWith(".class") ||
                    entry.name.matches(Regex("META-INF/.*\\.(SF|RSA|DSA)"))) continue
                zip.putNextEntry(ZipEntry(entry.name))
                source.getInputStream(entry).use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }
}

val remapClientToNamed = tasks.register("remapClientToNamed") {
    dependsOn(downloadMappings, downloadClient)
    inputs.files(clientJar, officialTiny)
    outputs.file(clientNamedJar)
    doLast { remap(clientJar.get().asFile, clientNamedJar.get().asFile, officialTiny.get().asFile, "official", "named") }
}

val generatedDescriptors = buildDirRef.dir("generated/sources/descriptors/java")
val generatedRuntimeMappings = buildDirRef.dir("generated/resources/runtime-mappings")

val genDescriptors = tasks.register("genDescriptors") {
    dependsOn(downloadMappings, downloadIntermediary)
    inputs.files(officialTiny, intermediaryTiny)
    outputs.dir(generatedDescriptors)
    doLast {
        val hookSpecs = listOf(
            "MINECRAFT" to Triple("net/minecraft/client/Minecraft", "tick", "()V"),
            "KEYBOARD_KEY_PRESS" to Triple("net/minecraft/client/KeyboardHandler", "keyPress", "KeyEvent;)V"),
            "KEY_EVENT_KEY" to Triple("net/minecraft/client/input/KeyEvent", "key", "()I"),
            "SCREEN_RENDER" to Triple("net/minecraft/client/gui/screens/Screen", "render", "GuiGraphics;IIF)V"),
            "SCREEN_MOUSE_CLICKED" to Triple("net/minecraft/client/gui/components/events/GuiEventListener", "mouseClicked", "MouseButtonEvent;Z)Z"),
            "SCREEN_KEY_PRESSED" to Triple("net/minecraft/client/gui/screens/Screen", "keyPressed", "KeyEvent;)Z"),
            "COMPONENT_LITERAL" to Triple("net/minecraft/network/chat/Component", "literal", "(Ljava/lang/String;)"),
            "MOUSE_BUTTON_EVENT_X" to Triple("net/minecraft/client/input/MouseButtonEvent", "x", "()D"),
            "MOUSE_BUTTON_EVENT_Y" to Triple("net/minecraft/client/input/MouseButtonEvent", "y", "()D"),
            "MOUSE_BUTTON_EVENT_BUTTON" to Triple("net/minecraft/client/input/MouseButtonEvent", "button", "()I"),
            "SCREEN_ON_CLOSE" to Triple("net/minecraft/client/gui/screens/Screen", "onClose", "()V"),
            "MINECRAFT_SET_SCREEN" to Triple("net/minecraft/client/Minecraft", "setScreen", "Screen;)V"),
            "PLAYER_ATTACK" to Triple("net/minecraft/world/entity/player/Player", "attack", "Entity;)V"),
            "MULTIPLAYER_ATTACK" to Triple("net/minecraft/client/multiplayer/MultiPlayerGameMode", "attack", "Player;Lnet/minecraft/world/entity/Entity;)V"),
            "USE_ITEM_ON" to Triple("net/minecraft/client/multiplayer/MultiPlayerGameMode", "useItemOn", "InteractionHand;Lnet/minecraft/world/phys/BlockHitResult;"),
            "LISTENER_SEND" to Triple("net/minecraft/client/multiplayer/ClientCommonPacketListenerImpl", "send", "protocol/Packet;)V"),
            "CONNECTION_SEND" to Triple("net/minecraft/network/Connection", "send", "protocol/Packet;)V"),
            "CLIENT_SET_ENTITY_MOTION" to Triple("net/minecraft/client/multiplayer/ClientPacketListener", "handleSetEntityMotion", "ClientboundSetEntityMotionPacket;)V"),
            "SEND_POSITION" to Triple("net/minecraft/client/player/LocalPlayer", "sendPosition", "()V"),
            "RENDER_LEVEL" to Triple("net/minecraft/client/renderer/LevelRenderer", "renderLevel", "Camera;"),
            "GAME_RENDER" to Triple("net/minecraft/client/renderer/GameRenderer", "render", "DeltaTracker;Z)V"),
            "GET_BLOCK_STATE" to Triple("net/minecraft/world/level/BlockGetter", "getBlockState", "BlockPos;)Lnet/minecraft/world/level/block/state/BlockState;"),
            "LEVEL_GET_BLOCK_STATE" to Triple("net/minecraft/world/level/Level", "getBlockState", "BlockPos;)Lnet/minecraft/world/level/block/state/BlockState;"),
            "EYE_HEIGHT" to Triple("net/minecraft/world/entity/Entity", "getEyeHeight", "()F"),
            "OVERLAY_MESSAGE" to Triple("net/minecraft/client/gui/Gui", "setOverlayMessage", "Component;Z)V"),
        )

        fun load(file: File): Triple<Map<String, String>, Map<String, String>, Map<String, List<Triple<String, String, String>>>> {
            val officialToAlt = HashMap<String, String>()
            val namedToOfficial = HashMap<String, String>()
            val members = HashMap<String, MutableList<Triple<String, String, String>>>()
            var currentOfficial: String? = null
            for (line in file.readLines()) {
                if (line.startsWith("tiny")) continue
                val parts = line.trimStart('\t').split('\t')
                when {
                    line.startsWith("c\t") && parts.size >= 3 -> {
                        currentOfficial = parts[1]
                        officialToAlt[parts[1]] = parts[2]
                        namedToOfficial[parts[2]] = parts[1]
                    }
                    (line.startsWith("\tm\t") || line.startsWith("\tf\t")) && parts.size >= 4 && currentOfficial != null -> {
                        val owner = currentOfficial ?: continue
                        members.getOrPut(owner) { ArrayList() }.add(Triple(parts[2], parts[3], parts[1]))
                    }
                }
            }
            return Triple(officialToAlt, namedToOfficial, members)
        }

        val (officialToIntermediary, _, intermediaryMembers) = load(intermediaryTiny.get().asFile)
        val (officialToNamed, namedToOfficial, officialMembers) = load(officialTiny.get().asFile)

        val out = StringBuilder()
        out.append("package bl.agent;\n\npublic final class Descriptors {\n    private Descriptors() {}\n")
        for ((key, spec) in hookSpecs) {
            val (ownerNamed, memberName, hint) = spec
            val officialOwner = namedToOfficial[ownerNamed]
                ?: error("Descriptor spec owner not in mappings: $ownerNamed")
            val intermediaryOwner = officialToIntermediary[officialOwner] ?: officialOwner

            val officialMatches = officialMembers[officialOwner].orEmpty()
                .filter { it.second == memberName && remapDescriptor(it.third, officialToNamed).contains(hint) }
            require(officialMatches.isNotEmpty()) { "No official descriptor match for $ownerNamed#$memberName ($hint)" }

            out.append("    public static final String[] CLASS_").append(key)
                .append(" = {\"").append(officialOwner).append("\", \"").append(intermediaryOwner).append("\"};\n")
            val intermediaryClassMembers = intermediaryMembers[officialOwner].orEmpty()
            val pairs = officialMatches.map { officialMember ->
                val intermediaryMember = intermediaryClassMembers.firstOrNull {
                    it.first == officialMember.first && it.third == officialMember.third
                } ?: intermediaryClassMembers.firstOrNull {
                    it.third == officialMember.third
                } ?: Triple(officialMember.first, officialMember.first, officialMember.third)
                officialMember to intermediaryMember
            }
            out.append("    public static final String[][] ").append(key).append(" = {\n")
            for ((officialMember, intermediaryMember) in pairs) {
                val intermediaryDescriptor = remapDescriptor(officialMember.third, officialToIntermediary)
                out.append("        {\"").append(officialMember.first).append("\", \"").append(intermediaryMember.second)
                    .append("\", \"").append(officialMember.third).append("\", \"").append(intermediaryDescriptor)
                    .append("\"},\n")
            }
            out.append("    };\n")
        }
        out.append("}\n")

        val target = generatedDescriptors.get().file("bl/agent/Descriptors.java").asFile
        target.parentFile.mkdirs()
        target.writeText(out.toString())
    }
}

val genRuntimeMappings = tasks.register("genRuntimeMappings") {
    dependsOn(downloadMappings, downloadIntermediary)
    inputs.files(officialTiny, intermediaryTiny)
    outputs.dir(generatedRuntimeMappings)
    doLast {
        data class Member(val kind: String, val officialName: String, val namedName: String, val descriptor: String)

        fun readTiny(file: File): Pair<Map<String, String>, Map<String, List<Member>>> {
            val classes = LinkedHashMap<String, String>()
            val members = LinkedHashMap<String, MutableList<Member>>()
            var owner: String? = null
            for (line in file.readLines()) {
                if (line.startsWith("tiny")) continue
                val parts = line.trimStart('\t').split('\t')
                when {
                    line.startsWith("c\t") && parts.size >= 3 -> {
                        owner = parts[1]
                        classes[parts[1]] = parts[2]
                    }
                    (line.startsWith("\tm\t") || line.startsWith("\tf\t")) &&
                        parts.size >= 4 && owner != null -> {
                        val currentOwner = owner ?: continue
                        val kind = parts[0]
                        members.getOrPut(currentOwner) { ArrayList() }.add(
                            Member(kind, parts[2], parts[3], parts[1])
                        )
                    }
                }
            }
            return classes to members
        }

        val (officialToNamed, namedMembers) = readTiny(officialTiny.get().asFile)
        val (officialToIntermediary, intermediaryMembers) = readTiny(intermediaryTiny.get().asFile)
        val output = StringBuilder()
        for ((officialOwner, namedOwner) in officialToNamed) {
            if (!namedOwner.startsWith("net/minecraft/")) continue
            val intermediaryOwner = officialToIntermediary[officialOwner] ?: officialOwner
            output.append("C\t").append(namedOwner).append('\t').append(officialOwner)
                .append('\t').append(intermediaryOwner).append('\n')
            val intermediaryBySignature = intermediaryMembers[officialOwner].orEmpty()
                .associateBy { "${it.kind}\t${it.officialName}\t${it.descriptor}" }
            for (member in namedMembers[officialOwner].orEmpty()) {
                val intermediaryMember = intermediaryBySignature[
                    "${member.kind}\t${member.officialName}\t${member.descriptor}"
                ]
                output.append(member.kind.uppercase()).append('\t').append(namedOwner).append('\t')
                    .append(member.namedName).append('\t').append(member.officialName).append('\t')
                    .append(intermediaryMember?.namedName ?: member.officialName).append('\n')
            }
        }

        val target = generatedRuntimeMappings.get().file("bl/agent/runtime-mappings.tsv").asFile
        target.parentFile.mkdirs()
        target.writeText(output.toString())
    }
}

sourceSets.main {
    java.srcDir(genDescriptors)
    resources.srcDir(generatedRuntimeMappings)
}

tasks.named("processResources") {
    dependsOn(genRuntimeMappings)
}

val applyManifest = tasks.register("applyManifest") {
    doLast {
        val manifest = Manifest().apply {
            mainAttributes[Attributes.Name.MANIFEST_VERSION] = "1.0"
            mainAttributes.putValue("Premain-Class", "bl.agent.Agent")
            mainAttributes.putValue("Can-Retransform-Classes", "true")
            mainAttributes.putValue("Implementation-Title", "lib")
            mainAttributes.putValue("Implementation-Version", project.version.toString())
        }
        for (jarFile in buildDirRef.dir("libs").get().asFile.listFiles().orEmpty()) {
            if (!jarFile.name.endsWith(".jar")) continue
            val temp = File(jarFile.parentFile, jarFile.name + ".tmp")
            ZipFile(jarFile).use { zip ->
                ZipOutputStream(temp.outputStream()).use { output ->
                    output.putNextEntry(ZipEntry("META-INF/MANIFEST.MF"))
                    manifest.write(output)
                    output.closeEntry()
                    for (entry in zip.entries()) {
                        if (entry.name == "META-INF/MANIFEST.MF" || entry.isDirectory) continue
                        output.putNextEntry(ZipEntry(entry.name))
                        zip.getInputStream(entry).copyTo(output)
                        output.closeEntry()
                    }
                }
            }
            JarFile(temp).use { check(it.manifest.mainAttributes.getValue("Premain-Class") == "bl.agent.Agent") }
            jarFile.delete()
            temp.renameTo(jarFile)
        }
    }
}

tasks.shadowJar {
    archiveClassifier.set("all")
    relocate("org.objectweb.asm", "bl.shaded.asm")
    manifest {
        attributes(
            "Premain-Class" to "bl.agent.Agent",
            "Can-Retransform-Classes" to "true",
            "Implementation-Title" to "lib",
        )
    }
}

val remapVanilla = tasks.register("remapVanilla") {
    dependsOn(tasks.shadowJar)
    inputs.files(shadowJarFile, officialTiny)
    outputs.file(buildDirRef.file("libs/agent-vanilla.jar"))
    doLast {
        val output = buildDirRef.file("libs/agent-vanilla.jar").get().asFile
        remap(shadowJarFile.get().asFile, output, officialTiny.get().asFile, "named", "official")
    }
    finalizedBy(applyManifest)
}

val remapFabric = tasks.register("remapFabric") {
    dependsOn(tasks.shadowJar, downloadMappings, downloadIntermediary)
    inputs.files(shadowJarFile, officialTiny, intermediaryTiny)
    outputs.file(buildDirRef.file("libs/agent-fabric.jar"))
    doLast {
        val officialJar = buildDirRef.file("tmp/agent-official.jar").get().asFile
        val output = buildDirRef.file("libs/agent-fabric.jar").get().asFile
        remap(shadowJarFile.get().asFile, officialJar, officialTiny.get().asFile, "named", "official")
        remap(officialJar, output, intermediaryTiny.get().asFile, "official", "intermediary")
    }
    finalizedBy(applyManifest)
}

val verifyRemap = tasks.register("verifyRemap") {
    dependsOn(remapVanilla)
    doLast {
        val jar = buildDirRef.file("libs/agent-vanilla.jar").get().asFile
        JarFile(jar).use { zip ->
            check(zip.getEntry("net/minecraft/client/Minecraft.class") == null) {
                "agent-vanilla.jar still contains net/minecraft/client/Minecraft"
            }
            check(zip.getEntry("bl/agent/Agent.class") != null) { "agent-vanilla.jar missing agent entrypoint" }
            check(zip.manifest.mainAttributes.getValue("Premain-Class") == "bl.agent.Agent") {
                "agent-vanilla.jar lost its Premain-Class"
            }
        }
    }
}

tasks.named("compileJava") {
    dependsOn(remapClientToNamed, genDescriptors)
}

tasks.named("build") {
    dependsOn(verifyRemap, remapFabric)
}
