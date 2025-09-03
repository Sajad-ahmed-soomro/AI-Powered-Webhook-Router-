import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

export async function readFromStream(streamName, count = 10) {
  try {
    const res = await redis.xrevrange(streamName, "+", "-", "COUNT", count);
    return res.map(([id, fields]) => {
      const obj = {};
      for (let i = 0; i < fields.length; i += 2) {
        obj[fields[i]] = fields[i + 1];
      }
      return { id, ...obj };
    });
  } catch (err) {
    console.error("Error reading stream:", err);
    return [];
  }
}
