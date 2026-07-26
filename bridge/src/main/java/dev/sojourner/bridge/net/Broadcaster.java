package dev.sojourner.bridge.net;

import dev.sojourner.bridge.BridgeConfig;
import dev.sojourner.bridge.SojournerBridge;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * Owns the WebSocket server across the integrated/dedicated server lifecycle and is the
 * single send entry point for the capture handlers. A volatile server reference keeps the
 * read on the game thread cheap and lock-free.
 */
public final class Broadcaster {
    public static final Broadcaster INSTANCE = new Broadcaster();

    private volatile BridgeWebSocketServer server;

    private Broadcaster() {}

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        BridgeWebSocketServer s = new BridgeWebSocketServer(BridgeConfig.BIND_HOST, BridgeConfig.PORT);
        s.setConnectionLostTimeout(30);
        s.start();
        server = s;
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        BridgeWebSocketServer s = server;
        server = null;
        if (s != null) {
            s.stopQuietly();
            SojournerBridge.LOG.info("[bridge] WebSocket stopped");
        }
    }

    /** True when at least one client is attached — capture handlers gate work on this. */
    public boolean active() {
        BridgeWebSocketServer s = server;
        return s != null && s.hasClients();
    }

    /** Send one pre-serialized envelope to all clients. No-op if the socket is down. */
    public void send(String json) {
        BridgeWebSocketServer s = server;
        if (s != null) s.broadcastJson(json);
    }
}
