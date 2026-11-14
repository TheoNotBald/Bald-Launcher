package bl.module.render;

import bl.Bl;
import bl.event.events.RenderLevelEvent;
import bl.mc.GizmoDraw;
import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;

public final class ItemESP extends Module {

    private final Setting color = setting(Setting.color("Color", 0xFFFFD166));
    private final Setting maxDistance = setting(Setting.decimal("Max distance", 64.0, 8.0, 128.0));
    private final Setting throughWalls = setting(Setting.bool("Through walls", true));

    public ItemESP() {
        super("ItemESP", Category.RENDER, true);
        Bl.bus().subscribe(this, RenderLevelEvent.class, event -> {
            if (enabled && isAvailable()) {
                GizmoDraw.inScope(event.levelRenderer, this::draw);
            }
        });
    }

    @Override
    protected void onTick() {
    }

    private void draw(Object levelRenderer) {
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        for (Object entity : Worlds.entitiesView()) {
            if (!Worlds.isItem(entity) || Worlds.distance(player, entity) > maxDistance.getDouble()) {
                continue;
            }
            Object bounds = Reflect.call(entity, "getBoundingBox");
            if (bounds == null) {
                throw new IllegalStateException("Could not read item entity bounds");
            }
            GizmoDraw.box(bounds, color.getColor(), 1.5f, throughWalls.getBool());
        }
    }
}
