import Redis from "ioredis";

let redis = null;

export async function connectRedis() {
  if (process.env.REDIS_ENABLED !== "true") {
    console.log("Redis disabled by configuration");
    return null;
  }

  const client = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });

  client.on("error", (err) => {
    console.warn(`Redis unavailable: ${err.message}`);
  });

  try {
    await client.connect();
    await client.ping();
    redis = client;
    console.log("Redis connected (PING successful)");
    return redis;
  } catch (error) {
    console.warn(`Redis not connected; continuing without cache: ${error.message}`);
    client.disconnect();
    return null;
  }
}

export function getRedis() {
  return redis;
}
