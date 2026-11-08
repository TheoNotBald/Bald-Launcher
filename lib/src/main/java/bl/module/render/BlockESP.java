package bl.module.render;

import java.util.ArrayList;
import java.util.List;

import bl.Bl;
import bl.event.events.RenderLevelEvent;
import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import net.minecraft.core.BlockPos;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.gizmos.GizmoProperties;
import net.minecraft.gizmos.GizmoStyle;
import net.minecraft.gizmos.Gizmos;

public final class BlockESP extends Module {

    private record Highlight(BlockPos position, int color) {
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
    }

    @Override
    protected void onUnavailable() {
        highlights = List.of();
        ticksUntilScan = 0;
    }

    private void scan() {
        Object player = Reflect.player();
        Object levelObject = Reflect.world();
        if (player == null || !(levelObject instanceof Level level)) {
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
                    BlockPos pos = new BlockPos(centerX + x, centerY + y, centerZ + z);
                    if (!level.isLoaded(pos)) {
                        continue;
                    }
                    BlockState state = level.getBlockState(pos);
                    int color = colorFor(state);
                    if (color != 0) {
                        found.add(new Highlight(pos.immutable(), color));
                    }
                }
            }
        }
        highlights = List.copyOf(found);
    }

    private int colorFor(BlockState state) {
        if (diamonds.getBool() && state.is(BlockTags.DIAMOND_ORES)) {
            return 0xFF55FFFF;
        }
        if (emeralds.getBool() && state.is(BlockTags.EMERALD_ORES)) {
            return 0xFF55FF55;
        }
        if (gold.getBool() && state.is(BlockTags.GOLD_ORES)) {
            return 0xFFFFD700;
        }
        if (iron.getBool() && state.is(BlockTags.IRON_ORES)) {
            return 0xFFD8D8D8;
        }
        if (redstone.getBool() && state.is(BlockTags.REDSTONE_ORES)) {
            return 0xFFFF4444;
        }
        if (lapis.getBool() && state.is(BlockTags.LAPIS_ORES)) {
            return 0xFF5577FF;
        }
        return 0;
    }

    private void draw() {
        for (Highlight highlight : highlights) {
            GizmoProperties outline = Gizmos.cuboid(highlight.position(),
                    GizmoStyle.stroke(highlight.color(), 1.5f));
            if (throughWalls.getBool()) {
                outline.setAlwaysOnTop();
            }
        }
    }
}
