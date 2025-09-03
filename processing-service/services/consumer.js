import redis from '../config/redis.js';
import { processPayload, persistResult, markFailed } from '../processors/webhookProcessor.js';
import  pool  from '../config/db.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch'; // for S3 fetching if needed
import client from 'prom-client'; // Prometheus
dotenv.config();
// processors/webhookProcessor.js - Enhanced version

const STREAM = process.env.STREAM_KEY || 'webhook_events';
const GROUP = process.env.CONSUMER_GROUP || 'processing_group';
const CONSUMER = process.env.CONSUMER_NAME || 'processor_1';
const BLOCK_MS = 5000;
const COUNT = 5;
const IDLE_MS_BEFORE_CLAIM = 60_000;
const CONCURRENCY = 3; // how many messages per batch



// Prometheus metrics
const processedSuccess = new client.Counter({
  name: 'processing_success_total',
  help: 'Total successfully processed messages'
});
const processedFail = new client.Counter({
  name: 'processing_fail_total',
  help: 'Total failed messages'
});
const retries = new client.Counter({
  name: 'processing_retries_total',
  help: 'Total messages retried'
});

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
    if (!(err && err.message && err.message.includes('BUSYGROUP'))) {
      console.error('Error creating group', err);
      throw err;
    }
  }
}

async function fetchFromS3(key) {
  // simplified: replace with AWS SDK / MinIO client
  const url = `${process.env.S3_BASE_URL}/${key}`;
  const res = await fetch(url);
  return await res.json();
}

async function claimStuckMessages() {
  try {
    const res = await redis.xautoclaim(
      STREAM,
      GROUP,
      CONSUMER,
      IDLE_MS_BEFORE_CLAIM,
      '0-0',
      'COUNT',
      10
    );
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
  }
}

async function handleMessage(id, parsed) {
  const rawPayload = parsed.payload || parsed.data;
  const logId = parsed.log_id || parsed.id;
  const s3Key = parsed.s3_key;

  if (!rawPayload && !s3Key) {
    console.warn('Message missing payload, acking:', id);
    await redis.xack(STREAM, GROUP, id);
    return;
  }

  let payload;
  try {
    payload = s3Key ? await fetchFromS3(s3Key) : JSON.parse(rawPayload);
  } catch (e) {
    console.error('Failed to parse payload', e);
    await redis.xack(STREAM, GROUP, id);
    return;
  }

  try {
    // mark as processing in DB
    if (logId) {
      await pool.query(
        `UPDATE ingestion.logs SET status = 'processing' WHERE id = $1`,
        [logId]
      );
    }

    // business logic
    const result = await processPayload(payload);

    // persist result and set status = pending (for router)
    await persistResult(logId, result);
    await pool.query(
      `UPDATE ingestion.logs SET status = 'pending' WHERE id = $1`,
      [logId]
    );

    // acknowledge message
    await redis.xack(STREAM, GROUP, id);

    processedSuccess.inc();
    console.log(` Processed message ${id} log ${logId}`);
  } catch (err) {
    console.error(' Processing error for message', id, err.message || err);
    processedFail.inc();

    if (logId) {
      // insert into retry queue
      await pool.query(
        `INSERT INTO retry_queue (log_id, error_message, attempts) 
         VALUES ($1, $2, 1)
         ON CONFLICT (log_id) DO UPDATE 
           SET attempts = retry_queue.attempts + 1,
               error_message = EXCLUDED.error_message,
               updated_at = now()`,
        [logId, err.message]
      );
      retries.inc();
      await markFailed(logId, err.message);
    }

    // ack to avoid stuck messages (since retried separately)
    await redis.xack(STREAM, GROUP, id);
  }
}

export async function startConsumerLoop() {
  await ensureGroup();

  console.log('Starting consumer loop...');

  // reclaim loop
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

      for (const [, entries] of streams) {
        // process messages with limited concurrency
        const promises = entries.map(([id, fields]) =>
          handleMessage(id, parseFields(fields))
        );
        for (let i = 0; i < promises.length; i += CONCURRENCY) {
          await Promise.all(promises.slice(i, i + CONCURRENCY));
        }
      }
    } catch (err) {
      console.error('Consumer loop error', err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await redis.quit();
  await pool.end();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await redis.quit();
  await pool.end();
  process.exit(0);
});
