package dev.sojourner.bridge.json;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

/**
 * Shared Gson instance + the message envelope. Gson ships inside Minecraft, so this
 * adds no dependency. Every WebSocket frame is one envelope:
 *
 *   { "type": "<event>", "tick": <serverTick>, "data": { ... } }
 *
 * See docs/protocol.md for the full message catalogue.
 */
public final class Json {
    public static final Gson GSON = new Gson();

    private Json() {}

    public static String envelope(String type, long tick, JsonObject data) {
        JsonObject o = new JsonObject();
        o.addProperty("type", type);
        o.addProperty("tick", tick);
        o.add("data", data);
        return GSON.toJson(o);
    }
}
