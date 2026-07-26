package dev.sojourner.bridge.capture;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * Pure (no I/O, no side effects) builders that snapshot live game objects into JSON.
 * Must be called on the server thread — they read entity/level state directly.
 */
public final class Snapshots {
    private Snapshots() {}

    public static JsonObject world(ServerLevel level) {
        JsonObject o = new JsonObject();
        o.addProperty("dimension", level.dimension().location().toString());
        o.addProperty("dayTime",   level.getDayTime());
        o.addProperty("seed",      level.getSeed());
        o.addProperty("raining",   level.isRaining());
        o.addProperty("thundering",level.isThundering());
        o.addProperty("difficulty",level.getDifficulty().getKey());
        BlockPos spawn = level.getSharedSpawnPos();
        o.add("spawn", xyz(spawn.getX(), spawn.getY(), spawn.getZ()));
        return o;
    }

    public static JsonObject player(ServerPlayer p) {
        JsonObject o = baseEntity(p);
        o.addProperty("name",      p.getGameProfile().getName());
        o.addProperty("health",    p.getHealth());
        o.addProperty("maxHealth", p.getMaxHealth());
        o.addProperty("food",      p.getFoodData().getFoodLevel());
        o.addProperty("saturation",p.getFoodData().getSaturationLevel());
        o.addProperty("xpLevel",   p.experienceLevel);
        o.addProperty("gameMode",  p.gameMode.getGameModeForPlayer().getName());
        o.addProperty("selectedSlot", p.getInventory().selected);
        o.addProperty("onGround",  p.onGround());
        o.add("effects",   effects(p));
        o.add("inventory", inventory(p));
        return o;
    }

    public static JsonObject entity(Entity e) {
        JsonObject o = baseEntity(e);
        if (e instanceof LivingEntity le) {
            o.addProperty("health",    le.getHealth());
            o.addProperty("maxHealth", le.getMaxHealth());
        }
        if (e instanceof net.minecraft.world.entity.item.ItemEntity item) {
            o.add("item", itemStack(item.getItem()));
        }
        return o;
    }

    public static JsonObject blockChange(ServerLevel level, BlockPos pos, BlockState state) {
        JsonObject o = new JsonObject();
        o.addProperty("dimension", level.dimension().location().toString());
        o.add("pos", xyz(pos.getX(), pos.getY(), pos.getZ()));
        o.addProperty("block", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
        o.addProperty("state", state.toString());
        return o;
    }

    public static JsonObject chunk(ServerLevel level, int chunkX, int chunkZ) {
        JsonObject o = new JsonObject();
        o.addProperty("dimension", level.dimension().location().toString());
        o.addProperty("cx", chunkX);
        o.addProperty("cz", chunkZ);
        return o;
    }

    // ── shared bits ─────────────────────────────────────────────────────────────

    private static JsonObject baseEntity(Entity e) {
        JsonObject o = new JsonObject();
        o.addProperty("id",   e.getId());
        o.addProperty("uuid", e.getUUID().toString());
        o.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
        o.add("pos", xyz(e.getX(), e.getY(), e.getZ()));
        Vec3 v = e.getDeltaMovement();
        o.add("velocity", xyz(v.x, v.y, v.z));
        o.addProperty("yaw",   e.getYRot());
        o.addProperty("pitch", e.getXRot());
        return o;
    }

    private static JsonArray effects(LivingEntity le) {
        JsonArray arr = new JsonArray();
        for (MobEffectInstance eff : le.getActiveEffects()) {
            JsonObject o = new JsonObject();
            o.addProperty("effect",    eff.getEffect().getRegisteredName());
            o.addProperty("amplifier", eff.getAmplifier());
            o.addProperty("duration",  eff.getDuration());
            arr.add(o);
        }
        return arr;
    }

    private static JsonArray inventory(ServerPlayer p) {
        JsonArray arr = new JsonArray();
        var items = p.getInventory().items;
        for (int slot = 0; slot < items.size(); slot++) {
            ItemStack stack = items.get(slot);
            if (stack.isEmpty()) continue;
            JsonObject o = itemStack(stack);
            o.addProperty("slot", slot);
            arr.add(o);
        }
        return arr;
    }

    private static JsonObject itemStack(ItemStack stack) {
        JsonObject o = new JsonObject();
        o.addProperty("item",  BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        o.addProperty("count", stack.getCount());
        return o;
    }

    private static JsonObject xyz(double x, double y, double z) {
        JsonObject o = new JsonObject();
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        return o;
    }
}
