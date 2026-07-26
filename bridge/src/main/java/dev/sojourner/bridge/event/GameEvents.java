package dev.sojourner.bridge.event;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.sojourner.bridge.BridgeConfig;
import dev.sojourner.bridge.capture.Snapshots;
import dev.sojourner.bridge.json.Json;
import dev.sojourner.bridge.net.Broadcaster;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.EntityLeaveLevelEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.ChunkEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Subscribes to NeoForge game events and forwards them as JSON envelopes.
 *
 * Two stream shapes:
 *   • periodic "tick" snapshot — players + nearby entities + world meta, every
 *     {@link BridgeConfig#SNAPSHOT_TICKS} ticks (the agent's heartbeat);
 *   • event deltas — entityAdd/entityRemove, chunkLoad/chunkUnload, blockChange.
 *
 * Everything runs on the server thread, so reads are safe; we only ever hand the
 * broadcaster finished strings. All work is gated on {@link Broadcaster#active()} so an
 * idle server with no listener pays nothing.
 *
 * NOTE: block deltas here cover player break/place only. Indirect changes (pistons, fluids,
 * explosions, growth) are not events — capturing those needs a Mixin into
 * {@code LevelChunk.setBlockState}. That's the planned next increment.
 */
public final class GameEvents {

    @SubscribeEvent
    public void onServerTick(ServerTickEvent.Post event) {
        if (!Broadcaster.INSTANCE.active()) return;
        MinecraftServer server = event.getServer();
        if (server.getTickCount() % BridgeConfig.SNAPSHOT_TICKS != 0) return;

        long tick = server.getTickCount();
        double r2 = BridgeConfig.ENTITY_RADIUS * BridgeConfig.ENTITY_RADIUS;

        for (ServerLevel level : server.getAllLevels()) {
            var players = level.players();
            if (players.isEmpty()) continue;

            JsonObject data = Snapshots.world(level);

            JsonArray playerArr = new JsonArray();
            for (ServerPlayer p : players) playerArr.add(Snapshots.player(p));
            data.add("players", playerArr);

            JsonArray entityArr = new JsonArray();
            for (Entity e : level.getAllEntities()) {
                if (e instanceof ServerPlayer) continue;
                if (nearAnyPlayer(e, players, r2)) entityArr.add(Snapshots.entity(e));
            }
            data.add("entities", entityArr);

            Broadcaster.INSTANCE.send(Json.envelope("tick", tick, data));
        }
    }

    @SubscribeEvent
    public void onEntityJoin(EntityJoinLevelEvent event) {
        if (!Broadcaster.INSTANCE.active()) return;
        if (!(event.getLevel() instanceof ServerLevel)) return;
        Broadcaster.INSTANCE.send(Json.envelope("entityAdd", tickOf(event.getLevel()),
                Snapshots.entity(event.getEntity())));
    }

    @SubscribeEvent
    public void onEntityLeave(EntityLeaveLevelEvent event) {
        if (!Broadcaster.INSTANCE.active()) return;
        if (!(event.getLevel() instanceof ServerLevel)) return;
        JsonObject o = new JsonObject();
        o.addProperty("id",   event.getEntity().getId());
        o.addProperty("uuid", event.getEntity().getUUID().toString());
        Broadcaster.INSTANCE.send(Json.envelope("entityRemove", tickOf(event.getLevel()), o));
    }

    @SubscribeEvent
    public void onChunkLoad(ChunkEvent.Load event) {
        if (!Broadcaster.INSTANCE.active()) return;
        if (!(event.getLevel() instanceof ServerLevel level)) return;
        var pos = event.getChunk().getPos();
        Broadcaster.INSTANCE.send(Json.envelope("chunkLoad", tickOf(level),
                Snapshots.chunk(level, pos.x, pos.z)));
    }

    @SubscribeEvent
    public void onChunkUnload(ChunkEvent.Unload event) {
        if (!Broadcaster.INSTANCE.active()) return;
        if (!(event.getLevel() instanceof ServerLevel level)) return;
        var pos = event.getChunk().getPos();
        Broadcaster.INSTANCE.send(Json.envelope("chunkUnload", tickOf(level),
                Snapshots.chunk(level, pos.x, pos.z)));
    }

    @SubscribeEvent
    public void onBlockBreak(BlockEvent.BreakEvent event) {
        if (!Broadcaster.INSTANCE.active()) return;
        if (!(event.getLevel() instanceof ServerLevel level)) return;
        // The block is still present in the event; report the resulting air explicitly.
        JsonObject o = Snapshots.blockChange(level, event.getPos(),
                net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        Broadcaster.INSTANCE.send(Json.envelope("blockChange", tickOf(level), o));
    }

    @SubscribeEvent
    public void onBlockPlace(BlockEvent.EntityPlaceEvent event) {
        if (!Broadcaster.INSTANCE.active()) return;
        if (!(event.getLevel() instanceof ServerLevel level)) return;
        Broadcaster.INSTANCE.send(Json.envelope("blockChange", tickOf(level),
                Snapshots.blockChange(level, event.getPos(), event.getPlacedBlock())));
    }

    // ── helpers ───────────────────────────────────────────────────────────────────

    private static boolean nearAnyPlayer(Entity e, java.util.List<ServerPlayer> players, double r2) {
        for (ServerPlayer p : players) {
            if (e.distanceToSqr(p) <= r2) return true;
        }
        return false;
    }

    private static long tickOf(net.minecraft.world.level.LevelAccessor level) {
        return level instanceof ServerLevel s ? s.getServer().getTickCount() : 0L;
    }
}
