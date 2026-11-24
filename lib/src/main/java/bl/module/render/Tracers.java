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

public final class Tracers extends Module {

    private final Setting players = setting(Setting.bool("Players", true));
    private final Setting mobs = setting(Setting.bool("Mobs", true));
    private final Setting color = setting(Setting.color("Color", EspPalette.TRACER));
    private final Setting thickness = setting(Setting.integer("Thickness", 1, 1, 3));
    private final Setting maxDistance = setting(Setting.decimal("Max distance", 64.0, 8.0, 64.0));
    private final Setting throughWalls = setting(Setting.bool("Through walls", true));

    public Tracers() {
        super("Tracers", Category.RENDER, true);
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
            if (entity == player) {
                continue;
            }
            boolean playerEntity = Worlds.isPlayer(entity);
            if (!(playerEntity && players.getBool()) && !(Worlds.isMob(entity) && mobs.getBool())) {
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
            if (bounds == null) {
                continue;
            }
            scene.tracer(
                    (bounds[0] + bounds[3]) * 0.5f,
                    bounds[1] + (bounds[4] - bounds[1]) * 0.55f,
                    (bounds[2] + bounds[5]) * 0.5f,
                    shaded, thickness.getInt());
        }
    }
}
