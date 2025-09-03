// services/dbService.js - Enhanced version
import pool from '../config/db.js'

export async function getWebhookStats(timeRange = '24h') {
  let interval;
  switch (timeRange) {
    case '1h': interval = '1 hour'; break;
    case '24h': interval = '24 hours'; break;
    case '7d': interval = '7 days'; break;
    default: interval = '24 hours';
  }

  const stats = await pool.query(`
    SELECT 
      COUNT(*) as total_webhooks,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
      AVG(size_bytes) as avg_payload_size,
      COUNT(DISTINCT source) as unique_sources
    FROM ingestion.logs 
    WHERE received_at >= NOW() - INTERVAL $1
  `, [interval]);

  return stats.rows[0];
}

export async function getProcessingMetrics() {
  const result = await pool.query(`
    SELECT 
      pr.processing_time_ms,
      il.category,
      il.source,
      il.status
    FROM processed_results pr
    JOIN ingestion.logs il ON pr.log_id = il.id
    WHERE pr.created_at >= NOW() - INTERVAL '24 hours'
  `);

  const metrics = result.rows.reduce((acc, row) => {
    const category = row.category || 'unknown';
    if (!acc[category]) {
      acc[category] = { count: 0, total_time: 0, avg_time: 0 };
    }
    acc[category].count++;
    acc[category].total_time += row.processing_time_ms || 0;
    acc[category].avg_time = acc[category].total_time / acc[category].count;
    return acc;
  }, {});

  return metrics;
}

export async function getDeliveryStats() {
  const result = await pool.query(`
    SELECT 
      status,
      COUNT(*) as count,
      AVG(attempts) as avg_attempts
    FROM delivery_logs
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY status
  `);

  return result.rows;
}


export async function getStats() {
  const res = await pool.query("SELECT COUNT(*) as total_logs FROM ingestion.logs");
  
  return res.rows[0];
}

export async function getCategoryDistribution() {
  const res = await pool.query(
    "SELECT source, COUNT(*) as count FROM ingestion.logs GROUP BY source"
  );

  console.log("category",res.rows)
  return res.rows;
}

export async function getRecentEvents(limit = 10) {
  const res = await pool.query(
    "SELECT * FROM ingestion.logs ORDER BY received_at DESC LIMIT $1",
    [limit]
  );
  console.log(res.rows)
  return res.rows;
}



export async function getErrorAnalysis(req, res) {
  try {
    const errors = await pool.query(`
      SELECT 
        error_message,
        COUNT(*) as frequency,
        MAX(created_at) as last_occurrence
      FROM retry_queue
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY error_message
      ORDER BY frequency DESC
      LIMIT 20
    `);

    res.json(errors.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get error analysis' });
  }
}