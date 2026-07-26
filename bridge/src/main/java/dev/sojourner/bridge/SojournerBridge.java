package dev.sojourner.bridge;

import com.mojang.logging.LogUtils;
import dev.sojourner.bridge.event.GameEvents;
import dev.sojourner.bridge.net.Broadcaster;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

/**
 * Entry point. Wires the runtime event handlers (which capture world state) and the
 * {@link Broadcaster} (which owns the WebSocket endpoint) onto the NeoForge game bus.
 *
 * This mod is read-only: it observes and streams, it never mutates the world. Actuation
 * (an agent driving the player) is a deliberately separate, later step.
 */
@Mod(SojournerBridge.MOD_ID)
public final class SojournerBridge {
    public static final String MOD_ID = "sojourner_bridge";
    public static final Logger LOG = LogUtils.getLogger();

    public SojournerBridge(IEventBus modBus) {
        // Game (runtime) events — tick / entity / chunk / block — live on the NeoForge bus.
        NeoForge.EVENT_BUS.register(new GameEvents());
        // Server start/stop lifecycle owns the socket; register the singleton handler.
        NeoForge.EVENT_BUS.register(Broadcaster.INSTANCE);
        LOG.info("[{}] initialised — bridge will bind {}:{} when a server starts",
                MOD_ID, BridgeConfig.BIND_HOST, BridgeConfig.PORT);
    }
}
