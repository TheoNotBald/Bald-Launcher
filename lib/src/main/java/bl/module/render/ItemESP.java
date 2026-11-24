package bl.module.render;

import bl.Bl;
import bl.event.events.RenderLevelEvent;
import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.render.EspPalette;
import bl.render.EspScene;

public final class ItemESP extends Module {

    private final Setting color = setting(Setting.color("Color", EspPalette.ITEM));
    private final Setting maxDistance = setting(Setting.decimal("Max distance", 64.0, 8.0, 128.0));
    private final Setting throughWalls = setting(Setting.bool("Through walls", true));

    public ItemESP() {
        super("ItemESP", Category.RENDER, true);
        Bl.bus().subscribe(this, RenderLevelEvent.class, event -> {
            if (enabled && isAvailable()) {
                draw();
            }
        });
    }

    @Override
    protected void onTick() {
    }

    private void draw() {
        EspScene scene = EspScene.get();
        Object player = Reflect.player();
        if (player == null || scene.blocked()) {
            return;
        }
        double max = maxDistance.getDouble();
        for (Object entity : Worlds.entities()) {
            if (!Worlds.isItem(entity)) {
                continue;
            }
            double distance = Worlds.distance(player, entity);
            if (distance > max) {
                continue;
            }
            int shaded = EspPalette.fade(color.getColor(), distance, max, 1.0f);
            if (shaded == 0) {
                continue;
            }
            float[] bounds = scene.entityBox(entity);
            if (bounds != null) {
                scene.box(scene.entityId(entity), bounds, shaded, throughWalls.getBool());
            }
        }
    }
}
