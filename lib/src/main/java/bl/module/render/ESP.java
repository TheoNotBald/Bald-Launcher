package bl.module.render;

import bl.Bl;
import bl.event.events.RenderLevelEvent;
import bl.mc.Reflect;
import bl.mc.Worlds;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.util.MathUtil;
import net.minecraft.gizmos.GizmoProperties;
import net.minecraft.gizmos.GizmoStyle;
import net.minecraft.gizmos.Gizmos;
import net.minecraft.world.phys.AABB;

public final class ESP extends Module {

    private final Setting entities = setting(Setting.bool("Players", true));
    private final Setting mobs = setting(Setting.bool("Mobs", true));
    private final Setting items = setting(Setting.bool("Items", false));
    private final Setting entityColor = setting(Setting.color("Player color", 0xFF3FA9F5));
    private final Setting mobColor = setting(Setting.color("Mob color", 0xFFFF6B6B));
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
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        for (Object entity : Worlds.entities()) {
            if (entity == player) {
                continue;
            }
            double distance = Worlds.distance(player, entity);
            if (distance > maxDistance.getDouble()) {
                continue;
            }
            int color;
            if (Worlds.isPlayer(entity) && entities.getBool()) {
                color = entityColor.getColor();
            } else if (Worlds.isMob(entity) && mobs.getBool()) {
                color = mobColor.getColor();
            } else if (Worlds.isItem(entity) && items.getBool()) {
                color = 0xFFFFD166;
            } else {
                continue;
            }
            int alpha = (int) (MathUtil.fade(color, distance, maxDistance.getDouble()) * 255.0f);
            int shaded = (alpha << 24) | (color & 0xFFFFFF);
            Object bounds = Reflect.call(entity, "getBoundingBox");
            if (!(bounds instanceof AABB box)) {
                throw new IllegalStateException("Could not read entity bounding box");
            }
            GizmoProperties outline = Gizmos.cuboid(box, GizmoStyle.stroke(shaded, 1.5f));
            if (alwaysOnTop.getBool()) {
                outline.setAlwaysOnTop();
            }
        }
    }
}
