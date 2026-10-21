import Redis from 'ioredis';

/**
 * Resilient Redis access.
 *
 * Redis holds short-lived state only (working memory, pre-session document refs),
 * so an outage must not take the KYC flow down. getRedis() returns a small facade:
 *   - Every write also lands in an in-process store (with TTL)
 *   - Reads come from Redis while it is reachable, else from the in-process store
 *   - Commands fail fast (no offline queue) instead of hanging the request
 *
 * The in-process store is per Node process — fine for a single Render instance.
 * Working memory is additionally mirrored to MongoDB every turn, so even a full
 * restart during an outage doesn't lose interview progress.
 */

let redisClient = null;
let facade = null;
let downSince = null;

const local = new Map(); // key → { value, expiresAt }

function localGet(key) {
  const entry = local.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    local.delete(key);
    return null;
  }
  return entry.value;
}

function localSet(key, value, ttlSeconds) {
  local.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
}

// Drop expired entries now and then so the fallback store can't grow without bound
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of local) if (e.expiresAt && e.expiresAt < now) local.delete(k);
}, 10 * 60 * 1000).unref();

function client() {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      // Exponential backoff: 0ms → 50ms → 100ms → ... → 5000ms max
      retryStrategy: (times) => Math.min(times * 50, 5000),
      lazyConnect: false,
      connectTimeout: 5000,
      enableOfflineQueue: false,  // fail fast while disconnected — the facade falls back locally
      maxRetriesPerRequest: 1,
    });

    redisClient.on('ready', () => {
      if (downSince) console.log(`✅ Redis reconnected after ${Math.round((Date.now() - downSince) / 1000)}s`);
      else console.log('✅ Redis connected');
      downSince = null;
    });
    redisClient.on('error', (err) => {
      // Log the first failure loudly, then stay quiet while it keeps retrying
      if (!downSince) {
        downSince = Date.now();
        console.error(`❌ Redis unavailable (${err.message}) — using in-process fallback store until it recovers`);
      }
    });
  }
  return redisClient;
}

const isUp = () => client().status === 'ready';

async function tryRedis(fn) {
  if (!isUp()) return { ok: false };
  try {
    return { ok: true, value: await fn(client()) };
  } catch {
    return { ok: false };
  }
}

/**
 * Returns the Redis facade (get / set / setex / del / quit).
 * Connects on first use — no changes needed to server.js boot sequence.
 */
export function getRedis() {
  if (facade) return facade;
  client();

  facade = {
    async get(key) {
      const r = await tryRedis(c => c.get(key));
      if (r.ok && r.value !== null) return r.value;
      return localGet(key); // Redis down, or key written while it was down
    },

    // Supports set(key, value) and set(key, value, 'EX', seconds)
    async set(key, value, mode, ttl) {
      const ttlSeconds = String(mode).toUpperCase() === 'EX' ? Number(ttl) : null;
      localSet(key, value, ttlSeconds);
      await tryRedis(c => (ttlSeconds ? c.set(key, value, 'EX', ttlSeconds) : c.set(key, value)));
      return 'OK';
    },

    async setex(key, ttlSeconds, value) {
      localSet(key, value, ttlSeconds);
      await tryRedis(c => c.setex(key, ttlSeconds, value));
      return 'OK';
    },

    async del(key) {
      local.delete(key);
      await tryRedis(c => c.del(key));
      return 1;
    },

    async quit() {
      return closeRedis();
    },
  };
  return facade;
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit().catch(() => redisClient.disconnect());
    redisClient = null;
    facade = null;
    console.log('🔌 Redis connection closed');
  }
}
