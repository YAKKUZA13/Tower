import 'dotenv/config';
import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

export async function connectRedis(): Promise<RedisClient> {
  if (client?.isOpen) return client;
  client = createClient({ url: redisUrl });
  client.on('error', (err) => {
    console.error('Redis error', err);
  });
  await client.connect();
  return client;
}

export function getRedis(): RedisClient {
  if (!client?.isOpen) {
    throw new Error('Redis client is not connected');
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) await client.quit();
}

export async function getRedisOrNull(): Promise<RedisClient | null> {
  try {
    return getRedis();
  } catch {
    return null;
  }
}
