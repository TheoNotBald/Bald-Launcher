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

public final class Nametags extends Module {

    private final Setting scale = setting(Setting.decimal("Scale", 1.0, 0.5, 2.0));
    private final Setting health = setting(Setting.bool("Health", true));
    private final Setting maxDistance = setting(Setting.decimal("Max distance", 64.0, 8.0, 128.0));

    public Nametags() {
        super("Nametags", Category.RENDER, true);
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
        float textScale = (float) scale.getDouble() * EspPalette.LABEL_SCALE;
        for (Object entity : Worlds.entities()) {
            if (entity == player || !Worlds.isPlayer(entity)) {
                continue;
            }
            if (Worlds.distance(player, entity) > max) {
                continue;
            }
            float[] bounds = scene.entityBox(entity);
            if (bounds == null) {
                continue;
            }
            String text = Worlds.displayName(entity);
            if (health.getBool()) {
                text = text + " " + String.format("%.1f", Worlds.health(entity));
            }
            scene.label(entity, 0,
                    (bounds[0] + bounds[3]) * 0.5f,
                    bounds[4] + 0.25f,
                    (bounds[2] + bounds[5]) * 0.5f,
                    text, EspPalette.LABEL_TEXT, EspPalette.LABEL_BACKGROUND, textScale);
        }
    }
}
