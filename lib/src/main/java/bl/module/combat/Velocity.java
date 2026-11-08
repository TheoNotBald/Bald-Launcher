package bl.module.combat;

import bl.Bl;
import bl.event.events.ReceiveMotionEvent;
import bl.mc.Worlds;
import bl.mc.Reflect;
import bl.module.Category;
import bl.module.Module;
import bl.module.Setting;
import bl.packet.PacketUtil;

public final class Velocity extends Module {

    private final Setting horizontal = setting(Setting.decimal("Horizontal knockback", 0.7, 0.0, 1.0));
    private final Setting vertical = setting(Setting.decimal("Vertical knockback", 0.85, 0.0, 1.0));
    private final Setting auraOnly = setting(Setting.bool("Only with KillAura", false));
    private final Setting groundedOnly = setting(Setting.bool("Only while grounded", false));

    public Velocity() {
        super("Velocity", Category.COMBAT, true);
        Bl.bus().subscribe(this, ReceiveMotionEvent.class, event -> {
            if (!enabled || !isAvailable()) {
                return;
            }
            if (auraOnly.getBool() && !killAuraActive()) {
                return;
            }
            Object player = Reflect.player();
            if (player == null) {
                return;
            }
            if (groundedOnly.getBool() && !Worlds.onGround(player)) {
                return;
            }
            Object packetEntityId = Reflect.call(event.packet, "getId");
            Object playerEntityId = Reflect.call(player, "getId");
            if (!(packetEntityId instanceof Number packetId) || !(playerEntityId instanceof Number playerId)
                    || packetId.intValue() != playerId.intValue()) {
                return;
            }
            if (!PacketUtil.scaleMotion(event.packet, horizontal.getDouble(), vertical.getDouble())) {
                throw new IllegalStateException("Received motion event did not contain a recognized velocity packet");
            }
        });
    }

    private boolean killAuraActive() {
        return Bl.modules().stream().anyMatch(module -> module.name.equals("KillAura") && module.enabled);
    }

    @Override
    protected void onTick() {
    }
}
