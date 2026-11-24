package bl.module.render;

import java.util.ArrayList;
import java.util.List;

import bl.Bl;
import bl.event.events.RenderLevelEvent;
import bl.mc.Reflect;
import bl.mc.Types;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.render.EspPalette;
import bl.render.EspScene;

public final class BlockESP extends Module {

    private record Highlight(int x, int y, int z, int color) {
    }

    private final Setting radius = setting(Setting.integer("Scan radius", 12, 4, 24));
    private final Setting verticalRadius = setting(Setting.integer("Vertical radius", 8, 2, 16));
    private final Setting scanInterval = setting(Setting.integer("Scan interval", 10, 2, 40));
    private final Setting diamonds = setting(Setting.bool("Diamond ores", true));
    private final Setting emeralds = setting(Setting.bool("Emerald ores", true));
    private final Setting gold = setting(Setting.bool("Gold ores", false));
    private final Setting iron = setting(Setting.bool("Iron ores", false));
    private final Setting redstone = setting(Setting.bool("Redstone ores", false));
    private final Setting lapis = setting(Setting.bool("Lapis ores", false));
    private final Setting throughWalls = setting(Setting.bool("Through walls", true));

    private List<Highlight> highlights = List.of();
    private int ticksUntilScan;
    private Object world;

    public BlockESP() {
        super("BlockESP", Category.RENDER, true);
        Bl.bus().subscribe(this, RenderLevelEvent.class, event -> {
            if (enabled && isAvailable()) {
                draw();
            }
        });
    }

    @Override
    protected void onTick() {
        Object currentWorld = Reflect.world();
        if (currentWorld != world) {
            // Dimension change or world unload: drop every cached highlight.
            highlights = List.of();
            ticksUntilScan = 0;
            world = currentWorld;
        }
        if (ticksUntilScan-- > 0) {
            return;
        }
        ticksUntilScan = scanInterval.getInt() - 1;
        scan();
    }

    @Override
    protected void onDisable() {
        highlights = List.of();
        ticksUntilScan = 0;
        world = null;
    }

    @Override
    protected void onUnavailable() {
        highlights = List.of();
        ticksUntilScan = 0;
        world = null;
    }

    private void scan() {
        Object player = Reflect.player();
        Object level = Reflect.world();
        if (player == null || level == null) {
            highlights = List.of();
            return;
        }
        int centerX = (int) Math.floor(Reflect.posX());
        int centerY = (int) Math.floor(Reflect.posY());
        int centerZ = (int) Math.floor(Reflect.posZ());
        int horizontal = radius.getInt();
        int vertical = verticalRadius.getInt();
        List<Highlight> found = new ArrayList<>();

        for (int x = -horizontal; x <= horizontal; x++) {
            for (int z = -horizontal; z <= horizontal; z++) {
                if (x * x + z * z > horizontal * horizontal) {
                    continue;
                }
                for (int y = -vertical; y <= vertical; y++) {
                    Object pos = blockPosition(centerX + x, centerY + y, centerZ + z);
                    Object state = Reflect.call(level, "getBlockState", pos);
                    if (state == null) {
                        throw new IllegalStateException("Could not read scanned block state");
                    }
                    int color = colorFor(state);
                    if (color != 0) {
                        found.add(new Highlight(centerX + x, centerY + y, centerZ + z, color));
                    }
                }
            }
        }
        highlights = List.copyOf(found);
    }

    private int colorFor(Object state) {
        if (diamonds.getBool() && hasTag(state, "DIAMOND_ORES")) {
            return EspPalette.ORE_DIAMOND;
        }
        if (emeralds.getBool() && hasTag(state, "EMERALD_ORES")) {
            return EspPalette.ORE_EMERALD;
        }
        if (gold.getBool() && hasTag(state, "GOLD_ORES")) {
            return EspPalette.ORE_GOLD;
        }
        if (iron.getBool() && hasTag(state, "IRON_ORES")) {
            return EspPalette.ORE_IRON;
        }
        if (redstone.getBool() && hasTag(state, "REDSTONE_ORES")) {
            return EspPalette.ORE_REDSTONE;
        }
        if (lapis.getBool() && hasTag(state, "LAPIS_ORES")) {
            return EspPalette.ORE_LAPIS;
        }
        return 0;
    }

    private boolean hasTag(Object state, String tagName) {
        Class<?> blockTags = Types.find("net/minecraft/registry/tag/BlockTags");
        Object tag = blockTags == null ? null : Reflect.call(blockTags, tagName);
        Object result = tag == null ? null : Reflect.call(state, "is", tag);
        if (!(result instanceof Boolean matches)) {
            throw new IllegalStateException("Could not check block tag " + tagName);
        }
        return matches;
    }

    private Object blockPosition(int x, int y, int z) {
        Class<?> type = Types.find("net/minecraft/util/math/BlockPos");
        if (type == null) {
            throw new IllegalStateException("Minecraft BlockPos type is unavailable");
        }
        try {
            return type.getConstructor(int.class, int.class, int.class).newInstance(x, y, z);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not create block position", error);
        }
    }

    private void draw() {
        EspScene scene = EspScene.get();
        if (scene.blocked()) {
            return;
        }
        boolean walls = throughWalls.getBool();
        for (Highlight highlight : highlights) {
            scene.blockBox(highlight.x(), highlight.y(), highlight.z(),
                    highlight.x() + 1.0f, highlight.y() + 1.0f, highlight.z() + 1.0f,
                    highlight.color(), walls);
        }
    }
}
