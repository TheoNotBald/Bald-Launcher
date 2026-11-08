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
import net.minecraft.gizmos.Gizmos;
import net.minecraft.world.phys.Vec3;

public final class Tracers extends Module {

    private final Setting players = setting(Setting.bool("Players", true));
    private final Setting mobs = setting(Setting.bool("Mobs", true));
    private final Setting color = setting(Setting.color("Color", 0xFF3FA9F5));
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
        Object player = Reflect.player();
        if (player == null) {
            return;
        }
        Object minecraft = Reflect.instance();
        Object renderer = Reflect.getField(minecraft, "gameRenderer");
        Object camera = Reflect.call(renderer, "getMainCamera");
        Object cameraPosition = Reflect.call(camera, "position");
        if (!(cameraPosition instanceof Vec3 origin)) {
            throw new IllegalStateException("Could not read the render camera position");
        }
        for (Object entity : Worlds.entities()) {
            if (entity == player) {
                continue;
            }
            boolean playerEntity = Worlds.isPlayer(entity);
            if (!(playerEntity && players.getBool()) && !(Worlds.isMob(entity) && mobs.getBool())) {
                continue;
            }
            double distance = Worlds.distance(player, entity);
            if (distance > maxDistance.getDouble()) {
                continue;
            }
            int alpha = (int) (MathUtil.fade(color.getColor(), distance, maxDistance.getDouble()) * 255.0f);
            int shaded = (alpha << 24) | (color.getColor() & 0xFFFFFF);
            double x = Worlds.coordinate(entity, "getX", "x");
            double y = Worlds.coordinate(entity, "getY", "y")
                    + (entity instanceof net.minecraft.world.entity.Entity mcEntity
                            ? mcEntity.getBbHeight() * 0.5
                            : 0.8);
            double z = Worlds.coordinate(entity, "getZ", "z");
            Vec3 destination = new Vec3(x, y, z);
            GizmoProperties line = Gizmos.line(origin, destination, shaded, thickness.getInt());
            if (throughWalls.getBool()) {
                line.setAlwaysOnTop();
            }
        }
    }
}
