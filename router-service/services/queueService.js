import  redis  from '../config/redis.js';
import dotenv from 'dotenv'
dotenv.config()

const group = process.env.CUSTOMER_GROUP
const consumer = process.env.CONSUMER_NAME

export async function readFromStream(streamName) {
  try {
    const result = await redis.xreadgroup(
      "GROUP",
      group,
      consumer,
      "BLOCK",
      5000,
      "COUNT",
      10,
      "STREAMS",
      streamName,
      ">"
    );

    if (!result) return [];
    const [ , entries ] = result[0];
    return entries.map(([id, fields]) => ({
      id,
      logId: fields[1],
      source: fields[3],
      payload: JSON.parse(fields[5])
    }));
  } catch (err) {
    console.error("Error reading from stream:", err);
    return [];
  }
}


