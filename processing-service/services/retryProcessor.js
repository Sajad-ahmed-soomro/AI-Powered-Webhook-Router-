// services/retryProcessor.js
import pool from '../config/db.js';
import redis from '../config/redis.js';
import { processPayload, persistResult, markFailed } from '../processors/webhookProcessor.js';

const STREAM = process.env.STREAM_KEY || 'webhook_events';
const RETRY_CHECK_INTERVAL = 60000; // Check every minute
const MAX_RETRIES = 5;
const BACKOFF_MULTIPLIER = 2; // Exponential backoff

// Calculate next retry time with exponential backoff
function calculateNextRetry(attempts) {
  const baseDelayMs = 60000; // Start with 1 minute
  const delayMs = baseDelayMs * Math.pow(BACKOFF_MULTIPLIER, attempts - 1);
  const maxDelayMs = 3600000; // Cap at 1 hour
  
  return Math.min(delayMs, maxDelayMs);
}

// Process events that are due for retry
async function processRetryQueue() {
  const client = await pool.connect();
  
  try {
    // Get events that are due for retry
    const retryEvents = await client.query(`
      SELECT rq.*, l.payload, l.source, l.category
      FROM retry_queue rq
      JOIN ingestion.logs l ON rq.log_id = l.id
      WHERE rq.next_retry_at <= NOW() 
        AND rq.attempts < $1
      ORDER BY rq.next_retry_at ASC
      LIMIT 10
    `, [MAX_RETRIES]);

    if (retryEvents.rows.length === 0) {
      return;
    }

    console.log(`Processing ${retryEvents.rows.length} retry events`);

    for (const retryEvent of retryEvents.rows) {
      try {
        await client.query('BEGIN');

        // Update retry attempt
        const nextAttempt = retryEvent.attempts + 1;
        const nextRetryDelay = calculateNextRetry(nextAttempt);
        const nextRetryAt = new Date(Date.now() + nextRetryDelay);

        await client.query(`
          UPDATE retry_queue 
          SET attempts = $1, 
              next_retry_at = $2, 
              updated_at = NOW()
          WHERE id = $3
        `, [nextAttempt, nextRetryAt, retryEvent.id]);

        // Update log status to processing
        await client.query(`
          UPDATE ingestion.logs 
          SET status = 'processing' 
          WHERE id = $1
        `, [retryEvent.log_id]);

        await client.query('COMMIT');

        // Process the event
        const payload = retryEvent.payload;
        const result = await processPayload(payload, retryEvent.category, retryEvent.source);

        // If successful, persist result and remove from retry queue
        await persistResult(retryEvent.log_id, result);
        
        await client.query(`
          UPDATE ingestion.logs 
          SET status = 'processed' 
          WHERE id = $1
        `, [retryEvent.log_id]);

        await client.query(`
          DELETE FROM retry_queue WHERE id = $1
        `, [retryEvent.id]);

        console.log(`Successfully retried event ${retryEvent.log_id} (attempt ${nextAttempt})`);

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Retry failed for event ${retryEvent.log_id}:`, error.message);

        // Check if max retries exceeded
        if (retryEvent.attempts + 1 >= MAX_RETRIES) {
          await moveToDeadLetterQueue(retryEvent, error.message);
        } else {
          // Update error message for this retry attempt
          await client.query(`
            UPDATE retry_queue 
            SET error_message = $1, updated_at = NOW()
            WHERE id = $2
          `, [error.message, retryEvent.id]);

          await markFailed(retryEvent.log_id, error.message);
        }
      }
    }

  } catch (error) {
    console.error('Error processing retry queue:', error);
  } finally {
    client.release();
  }
}

// Move event to dead letter queue after max retries
async function moveToDeadLetterQueue(retryEvent, finalError) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Create dead letter queue table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id SERIAL PRIMARY KEY,
        log_id UUID REFERENCES ingestion.logs(id),
        final_error TEXT,
        attempts_made INTEGER,
        moved_at TIMESTAMP DEFAULT NOW(),
        original_retry_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert into dead letter queue
    await client.query(`
      INSERT INTO dead_letter_queue 
      (log_id, final_error, attempts_made, original_retry_id)
      VALUES ($1, $2, $3, $4)
    `, [retryEvent.log_id, finalError, retryEvent.attempts + 1, retryEvent.id]);

    // Remove from retry queue
    await client.query(`
      DELETE FROM retry_queue WHERE id = $1
    `, [retryEvent.id]);

    // Mark log as failed
    await client.query(`
      UPDATE ingestion.logs 
      SET status = 'failed' 
      WHERE id = $1
    `, [retryEvent.log_id]);

    await client.query('COMMIT');
    
    console.log(`Moved event ${retryEvent.log_id} to dead letter queue after ${retryEvent.attempts + 1} attempts`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error moving event to dead letter queue:`, error);
  } finally {
    client.release();
  }
}

// Cleanup old dead letter queue entries
async function cleanupDeadLetterQueue() {
  try {
    const retentionDays = process.env.DLQ_RETENTION_DAYS || 30;
    
    const result = await pool.query(`
      DELETE FROM dead_letter_queue 
      WHERE moved_at < NOW() - INTERVAL '${retentionDays} days'
      RETURNING id
    `);

    if (result.rows.length > 0) {
      console.log(`Cleaned up ${result.rows.length} old dead letter queue entries`);
    }
  } catch (error) {
    // Table might not exist yet
    if (!error.message.includes('does not exist')) {
      console.error('Error cleaning up dead letter queue:', error);
    }
  }
}

// Start the retry processor
export async function startRetryProcessor() {
  console.log('Starting retry processor...');

  // Process retries
  setInterval(async () => {
    try {
      await processRetryQueue();
    } catch (error) {
      console.error('Retry processor error:', error);
    }
  }, RETRY_CHECK_INTERVAL);

  // Cleanup old DLQ entries daily
  setInterval(async () => {
    try {
      await cleanupDeadLetterQueue();
    } catch (error) {
      console.error('DLQ cleanup error:', error);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours

  // Initial cleanup
  setTimeout(cleanupDeadLetterQueue, 5000);
}

export { processRetryQueue, moveToDeadLetterQueue };