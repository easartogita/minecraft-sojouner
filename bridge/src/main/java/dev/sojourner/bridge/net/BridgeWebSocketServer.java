package dev.sojourner.bridge.net;

import dev.sojourner.bridge.SojournerBridge;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;

/**
 * Thin {@link WebSocketServer} wrapper. Runs on its own thread (Java-WebSocket spins up
 * a selector thread), so it must never touch live game objects — callers hand it
 * already-serialized JSON strings produced on the server thread.
 *
 * v1 is one-way (telemetry out). Inbound frames are logged and ignored; they become the
 * command channel in the actuation step.
 */
public final class BridgeWebSocketServer extends WebSocketServer {

    public BridgeWebSocketServer(String host, int port) {
        super(new InetSocketAddress(host, port));
        setReuseAddr(true);
    }

    /** Fan a frame out to every connected client. {@code broadcast} is thread-safe. */
    public void broadcastJson(String json) {
        broadcast(json);
    }

    public boolean hasClients() {
        return !getConnections().isEmpty();
    }

    @Override public void onStart() {
        SojournerBridge.LOG.info("[bridge] WebSocket listening on {}", getAddress());
    }

    @Override public void onOpen(WebSocket conn, ClientHandshake handshake) {
        SojournerBridge.LOG.info("[bridge] client connected: {}", conn.getRemoteSocketAddress());
    }

    @Override public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        SojournerBridge.LOG.info("[bridge] client disconnected: {} ({})", conn.getRemoteSocketAddress(), reason);
    }

    @Override public void onMessage(WebSocket conn, String message) {
        // Reserved for the command channel; ignored while the bridge is read-only.
        SojournerBridge.LOG.debug("[bridge] inbound (ignored): {}", message);
    }

    @Override public void onError(WebSocket conn, Exception ex) {
        SojournerBridge.LOG.error("[bridge] socket error", ex);
    }

    public void stopQuietly() {
        try {
            stop(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
