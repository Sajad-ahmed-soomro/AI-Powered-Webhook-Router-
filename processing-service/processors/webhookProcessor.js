import pool from '../config/db.js';

export async function processPayload(payload) {
  const summary = {
    length: JSON.stringify(payload).length,
    enrichedAt: new Date().toISOString(),
  };
  return summary;
}

export async function persistResult(logId, result) {
  try {
    await pool.query(
      `INSERT INTO processed_results (log_id, result) VALUES ($1, $2::jsonb)`,
      [logId, JSON.stringify(result)]
    );
    await pool.query(
      `UPDATE ingestion.logs SET status = 'processed' WHERE id = $1`,
      [logId]
    );
  } catch (err) {
    console.error(`Error persisting result for log ${logId}:`, err);
    throw err;
  }
}

export async function markFailed(logId, errMsg) {
  try {
    await pool.query(
      `INSERT INTO retry_queue (log_id, error_message, attempts) VALUES ($1, $2, 1)`,
      [logId, errMsg]
    );
    await pool.query(
      `UPDATE ingestion.logs SET status = 'failed' WHERE id = $1`,
      [logId]
    );
  } catch (err) {
    console.error(`Error marking log ${logId} as failed:`, err);
    throw err;
  }
}
