package bl.module.render;

import bl.Bl;
import bl.event.events.RenderLevelEvent;
import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import net.minecraft.gizmos.Gizmos;
import net.minecraft.world.entity.Entity;

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
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        for (Object entity : Worlds.entities()) {
            if (entity == player || !Worlds.isPlayer(entity)) {
                continue;
            }
            if (Worlds.distance(player, entity) > maxDistance.getDouble()) {
                continue;
            }
            String text = Worlds.displayName(entity);
            if (health.getBool()) {
                text += " " + String.format("%.1f", Worlds.health(entity));
            }
            if (!(entity instanceof Entity mcEntity)) {
                throw new IllegalStateException("Could not resolve player entity for nametag");
            }
            Gizmos.billboardTextOverMob(mcEntity, 0xFFFFFFFF, text, 0x90000000,
                    (float) scale.getDouble());
        }
    }
}
