package dev.sojourner.bridge;

/**
 * Lightweight, read-once config sourced from JVM system properties (with env-var fallback),
 * so it works on a dedicated server launch script as well as a singleplayer client.
 *
 *   -Dsojourner.bridge.port=25599
 *   -Dsojourner.bridge.host=127.0.0.1
 *   -Dsojourner.bridge.snapshotTicks=4
 *   -Dsojourner.bridge.entityRadius=64
 *
 * Kept deliberately minimal for v1; promote to a NeoForge config spec if it grows.
 */
public final class BridgeConfig {
    /** TCP port the WebSocket server binds. */
    public static final int    PORT           = intProp("port", 25599);
    /** Bind address — loopback by default so the stream never leaves the machine. */
    public static final String BIND_HOST      = strProp("host", "127.0.0.1");
    /** Emit a player/entity/world snapshot every N server ticks (20 tps → 4 ≈ 5 Hz). */
    public static final int    SNAPSHOT_TICKS = Math.max(1, intProp("snapshotTicks", 4));
    /** Only entities within this many blocks of a player are streamed. */
    public static final double ENTITY_RADIUS  = dblProp("entityRadius", 64.0);

    private BridgeConfig() {}

    private static String raw(String key) {
        String p = System.getProperty("sojourner.bridge." + key);
        if (p != null) return p;
        return System.getenv("SOJOURNER_BRIDGE_" + key.toUpperCase());
    }
    private static String strProp(String k, String d) { String v = raw(k); return v == null ? d : v; }
    private static int    intProp(String k, int d)    { try { return Integer.parseInt(raw(k)); } catch (Exception e) { return d; } }
    private static double dblProp(String k, double d) { try { return Double.parseDouble(raw(k)); } catch (Exception e) { return d; } }
}
