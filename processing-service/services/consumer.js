import redis from '../config/redis.js';
import { processPayload, persistResult, markFailed } from '../processors/webhookProcessor.js';
import dotenv from 'dotenv';
dotenv.config();

const STREAM = process.env.STREAM_KEY || 'webhook_events';
const GROUP = process.env.CONSUMER_GROUP || 'processing_group';
const CONSUMER = process.env.CONSUMER_NAME || 'processor_1';
const BLOCK_MS = 5000;
const COUNT = 5;
const IDLE_MS_BEFORE_CLAIM = 60_000; // messages idle longer than this may be reclaimed

function parseFields(fieldArray) {
  const obj = {};
  for (let i = 0; i < fieldArray.length; i += 2) {
    obj[fieldArray[i]] = fieldArray[i + 1];
  }
  return obj;
}

export async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    console.log('Consumer group created:', GROUP);
  } catch (err) {
    if (err && err.message && err.message.includes('BUSYGROUP')) {
      // group exists
    } else {
      console.error('Error creating group', err);
      throw err;
    }
  }
}

/**
 * Try to claim pending messages that have been idle for too long.
 * Requires Redis >= 6.2 for XAUTOCLAIM (ioredis exposes xautoclaim).
 */
async function claimStuckMessages() {
  try {
    // Attempt to claim messages idle > IDLE_MS_BEFORE_CLAIM, starting from 0
    const res = await redis.xautoclaim(STREAM, GROUP, CONSUMER, IDLE_MS_BEFORE_CLAIM, '0-0', 'COUNT', 10);
    // xautoclaim returns [next-id, [[id, [field, val...]], ...]]
    if (res && res[1]) {
      const entries = res[1];
      for (const [id, fields] of entries) {
        await handleMessage(id, parseFields(fields));
      }
    }
  } catch (err) {
    if (!err.message.includes('ERR unknown command')) {
      console.error('xautoclaim error', err);
    }
    // If xautoclaim not supported, we skip reclaim logic.
  }
}

async function handleMessage(id, parsed) {
  // Expecting at least: parsed.log_id and parsed.payload (stringified JSON)
  const rawPayload = parsed.payload || parsed.data;
  const logId = parsed.log_id || parsed.id; // flexible
  if (!rawPayload) {
    console.warn('Message missing payload, acking:', id);
    await redis.xack(STREAM, GROUP, id);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch (e) {
    payload = rawPayload;
  }

  try {
    // optional: mark ingestion.log as processing (best-effort)
    if (logId) {
      await persistProcessingMarker(logId);
    }

    // do processing
    const result = await processPayload(payload);

    // persist result + mark processed
    await persistResult(logId, result);

    // acknowledge
    await redis.xack(STREAM, GROUP, id);
    // optionally delete message from stream to keep stream small
    // await redis.xdel(STREAM, id);

    console.log(`Processed message ${id} log ${logId}`);
  } catch (err) {
    console.error('Processing error for message', id, err.message || err);
    // add to retry queue in DB and mark failed
    await markFailed(logId, (err && err.message) || String(err));
    // acknowledge so it doesn't get stuck forever (or choose to leave unacked)
    await redis.xack(STREAM, GROUP, id);
  }
}

async function persistProcessingMarker(logId) {
  try {
    await (await import('../config/db.js')).default.query(
      `UPDATE ingestion.logs SET status = 'processing' WHERE id = $1`,
      [logId]
    );
  } catch (err) {
    // ignore - not critical
  }
}

export async function startConsumerLoop() {
  await ensureGroup();

  console.log('Starting consumer loop...');

  // Start a reclaim attempt periodically
  setInterval(() => {
    claimStuckMessages().catch((e) => console.error('claimStuckMessages err', e));
  }, 60_000);

  while (true) {
    try {
      const streams = await redis.xreadgroup(
        'GROUP',
        GROUP,
        CONSUMER,
        'BLOCK',
        BLOCK_MS,
        'COUNT',
        COUNT,
        'STREAMS',
        STREAM,
        '>'
      );
      if (!streams) continue;

      // streams is [[streamKey, [[id, [field, value, ...]], ...]]]
      for (const [, entries] of streams) {
        for (const [id, fields] of entries) {
          const parsed = parseFields(fields);
          await handleMessage(id, parsed);
        }
      }
    } catch (err) {
      console.error('Consumer loop error', err);
      // small delay on fatal errors
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
