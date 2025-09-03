import { getStats, getCategoryDistribution, getRecentEvents } from "./dbService.js";
import { readFromStream } from "./redisService.js";

export async function fetchStats() {
  return await getStats();
}

export async function fetchCategoryDistribution() {
  return await getCategoryDistribution();
}

export async function fetchRecentEvents({category, useRedis = false, limit = 10 }) {
  if (useRedis) {
    const streamName = `stream_${category}`;
    return await readFromStream(streamName, limit);
  }
  return await getRecentEvents(limit);
}
