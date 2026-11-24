package bl.agent;

import java.lang.instrument.Instrumentation;

import bl.agent.hook.AttackHook;
import bl.agent.hook.CriticalAttackHook;
import bl.agent.hook.EyeHeightHook;
import bl.agent.hook.GameRenderHook;
import bl.agent.hook.GetBlockStateHook;
import bl.agent.hook.HitboxHook;
import bl.agent.hook.KeyboardHook;
import bl.agent.hook.OverlayMessageHook;
import bl.agent.hook.PacketHook;
import bl.agent.hook.PositionCorrectionHook;
import bl.agent.hook.ReceiveMotionHook;
import bl.agent.hook.RenderLevelHook;
import bl.agent.hook.SendPositionHook;
import bl.agent.hook.SetScreenHook;
import bl.agent.hook.StuckHook;
import bl.agent.hook.TickHook;
import bl.agent.hook.UseItemOnHook;

public final class Agent {

    private Agent() {
    }

    public static void premain(String args, Instrumentation instrumentation) {
        System.out.println("[Bald Agent] premain loaded");
        GlfwProvisioner.provision();
        try {
            Patcher patcher = new Patcher();
            patcher.register(Descriptors.CLASS_MINECRAFT, new TickHook());
            patcher.register(Descriptors.CLASS_KEYBOARD_KEY_PRESS, new KeyboardHook());
            patcher.register(Descriptors.CLASS_MINECRAFT_SET_SCREEN, new SetScreenHook());
            patcher.register(Descriptors.CLASS_PLAYER_ATTACK, new AttackHook());
            patcher.register(Descriptors.CLASS_PLAYER_MAKE_STUCK, new StuckHook());
            patcher.register(Descriptors.CLASS_MULTIPLAYER_ATTACK, new CriticalAttackHook());
            patcher.register(Descriptors.CLASS_USE_ITEM_ON, new UseItemOnHook());
            patcher.register(Descriptors.CLASS_LISTENER_SEND, new PacketHook(true));
            patcher.register(Descriptors.CLASS_CONNECTION_SEND, new PacketHook(false));
            patcher.register(Descriptors.CLASS_CLIENT_SET_ENTITY_MOTION, new ReceiveMotionHook());
            patcher.register(Descriptors.CLASS_PLAYER_POSITION_LOOK, new PositionCorrectionHook());
            patcher.register(Descriptors.CLASS_SEND_POSITION, new SendPositionHook());
            patcher.register(Descriptors.CLASS_RENDER_LEVEL, new RenderLevelHook());
            patcher.register(Descriptors.CLASS_GAME_RENDER, new GameRenderHook());
            patcher.register(Descriptors.CLASS_GET_BLOCK_STATE, new GetBlockStateHook());
            patcher.register(Descriptors.CLASS_LEVEL_GET_BLOCK_STATE, new GetBlockStateHook());
            patcher.register(Descriptors.CLASS_EYE_HEIGHT, new EyeHeightHook());
            patcher.register(Descriptors.CLASS_ENTITY_BOUNDING_BOX, new HitboxHook());
            patcher.register(Descriptors.CLASS_OVERLAY_MESSAGE, new OverlayMessageHook());
            instrumentation.addTransformer(patcher, true);
            System.out.println("[Bald Agent] Waiting for the game classloader before initializing modules");
        } catch (Throwable t) {
            System.err.println("[Bald Agent] Agent startup failed");
            t.printStackTrace(System.err);
        }
    }
}
