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

public final class ESP extends Module {

    private final Setting entities = setting(Setting.bool("Players", true));
    private final Setting mobs = setting(Setting.bool("Mobs", true));
    private final Setting items = setting(Setting.bool("Items", false));
    private final Setting entityColor = setting(Setting.color("Player color", EspPalette.PLAYER));
    private final Setting mobColor = setting(Setting.color("Mob color", EspPalette.MOB));
    private final Setting maxDistance = setting(Setting.decimal("Max distance", 64.0, 8.0, 64.0));
    private final Setting alwaysOnTop = setting(Setting.bool("Through walls", true));

    public ESP() {
        super("ESP", Category.RENDER, true);
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
        boolean throughWalls = alwaysOnTop.getBool();
        for (Object entity : Worlds.entities()) {
            if (entity == player) {
                continue;
            }
            double distance = Worlds.distance(player, entity);
            if (distance > max) {
                continue;
            }
            int color;
            if (Worlds.isPlayer(entity) && entities.getBool()) {
                color = entityColor.getColor();
            } else if (Worlds.isMob(entity) && mobs.getBool()) {
                color = mobColor.getColor();
            } else if (Worlds.isItem(entity) && items.getBool()) {
                color = EspPalette.ITEM;
            } else {
                continue;
            }
            int shaded = EspPalette.fade(color, distance, max, 1.0f);
            if (shaded == 0) {
                continue;
            }
            float[] bounds = scene.entityBox(entity);
            if (bounds != null) {
                scene.box(scene.entityId(entity), bounds, shaded, throughWalls);
            }
        }
    }
}
