import Redis from 'ioredis';

let redisClient = null;

/**
 * Returns a singleton ioredis client.
 * Connects lazily on first use — no changes needed to server.js boot sequence.
 */
export function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      // Exponential backoff: 0ms → 50ms → 100ms → ... → 2000ms max
      retryStrategy: (times) => Math.min(times * 50, 2000),
      lazyConnect: true,
      enableOfflineQueue: true,   // Queue commands while reconnecting
      maxRetriesPerRequest: 3,
    });

    redisClient.on('connect', () =>
      console.log('✅ Redis connected')
    );
    redisClient.on('error', (err) =>
      console.error('❌ Redis error:', err.message)
    );
    redisClient.on('reconnecting', () =>
      console.warn('⚠️  Redis reconnecting...')
    );
  }
  return redisClient;
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('🔌 Redis connection closed');
  }
}
