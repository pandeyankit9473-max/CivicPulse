import { getRedis } from "../config/redis.js";

const LIST_KEY = "civicpulse:issues:list:v4";
const TTL_SECONDS = 30;

export async function readIssueListCache() {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const cached = await redis.get(LIST_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export async function writeIssueListCache(issues) {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(LIST_KEY, JSON.stringify(issues), "EX", TTL_SECONDS);
  } catch (error) {
    console.warn("Could not write issue cache:", error.message);
  }
}

export async function invalidateIssueListCache() {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(LIST_KEY);
  } catch (error) {
    console.warn("Could not invalidate issue cache:", error.message);
  }
}
