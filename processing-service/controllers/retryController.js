// controllers/retryController.js
import pool from '../config/db.js';
import redis from '../config/redis.js';

const STREAM = process.env.STREAM_KEY || 'webhook_events';

export const getRetryQueue = async (req, res) => {
  try {
    const { limit = 100, offset = 0, status = 'all' } = req.query;
    
    let whereClause = 'WHERE rq.attempts < 5';
    if (status === 'high_attempts') {
      whereClause = 'WHERE rq.attempts >= 3 AND rq.attempts < 5';
    } else if (status === 'ready') {
      whereClause = 'WHERE rq.next_retry_at <= NOW() AND rq.attempts < 5';
    }

    const result = await pool.query(`
      SELECT 
        rq.id,
        rq.log_id,
        rq.error_message as reason,
        rq.attempts,
        rq.created_at as last_tried,
        rq.next_retry_at,
        rq.updated_at,
        l.source,
        l.category as event,
        l.status,
        l.received_at,
        SUBSTRING(l.payload::text, 1, 100) as payload_preview
      FROM retry_queue rq
      JOIN ingestion.logs l ON rq.log_id = l.id
      ${whereClause}
      ORDER BY rq.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM retry_queue rq
      JOIN ingestion.logs l ON rq.log_id = l.id
      ${whereClause}
    `);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching retry queue:', error);
    res.status(500).json({ error: 'Failed to fetch retry queue' });
  }
};

export const retryEvent = async (req, res) => {
  const { id, log_id } = req.body;
  
  if (!id || !log_id) {
    return res.status(400).json({ error: 'id and log_id are required' });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verify the retry entry exists
    const retryResult = await client.query(
      'SELECT * FROM retry_queue WHERE id = $1 AND log_id = $2',
      [id, log_id]
    );
    
    if (retryResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Retry entry not found' });
    }

    // Reset the retry timer for immediate processing
    await client.query(`
      UPDATE retry_queue 
      SET next_retry_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Reset the log status back to pending for reprocessing
    await client.query(`
      UPDATE ingestion.logs 
      SET status = 'pending' 
      WHERE id = $1
    `, [log_id]);

    // Get the original payload to re-add to stream
    const logResult = await client.query(
      'SELECT payload, source FROM ingestion.logs WHERE id = $1',
      [log_id]
    );

    if (logResult.rows.length > 0) {
      // Add back to Redis stream for immediate processing
      await redis.xadd(
        STREAM,
        '*',
        'log_id', log_id,
        'payload', JSON.stringify(logResult.rows[0].payload),
        'source', logResult.rows[0].source,
        'retry', 'true'
      );
    }

    await client.query('COMMIT');
    
    console.log(`Manual retry triggered for log_id: ${log_id}, retry_id: ${id}`);
    res.json({ 
      message: 'Event queued for retry', 
      log_id,
      retry_id: id,
      status: 'queued'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error retrying event:', error);
    res.status(500).json({ error: 'Failed to retry event' });
  } finally {
    client.release();
  }
};

export const moveToDeadLetter = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'Retry queue ID is required' });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get the retry queue entry
    const retryResult = await client.query(
      'SELECT * FROM retry_queue WHERE id = $1',
      [id]
    );
    
    if (retryResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Retry queue entry not found' });
    }
    
    const retryEntry = retryResult.rows[0];
    
    // Create dead_letter_queue table if it doesn't exist
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
    
    // Move to dead letter queue
    const dlqResult = await client.query(`
      INSERT INTO dead_letter_queue (log_id, final_error, attempts_made, original_retry_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [
      retryEntry.log_id,
      retryEntry.error_message,
      retryEntry.attempts,
      retryEntry.id
    ]);

    // Remove from retry queue
    await client.query('DELETE FROM retry_queue WHERE id = $1', [id]);
    
    // Update log status to failed
    await client.query(`
      UPDATE ingestion.logs 
      SET status = 'failed' 
      WHERE id = $1
    `, [retryEntry.log_id]);
    
    await client.query('COMMIT');
    
    console.log(`Moved retry entry ${id} to dead letter queue (DLQ ID: ${dlqResult.rows[0].id})`);
    res.json({ 
      message: 'Moved to dead letter queue',
      dlq_id: dlqResult.rows[0].id,
      original_retry_id: id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error moving to DLQ:', error);
    res.status(500).json({ error: 'Failed to move to dead letter queue' });
  } finally {
    client.release();
  }
};

export const getRetryStats = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_retries,
        COUNT(CASE WHEN attempts >= 3 THEN 1 END) as high_attempts,
        COUNT(CASE WHEN next_retry_at <= NOW() + INTERVAL '1 hour' THEN 1 END) as next_hour,
        COUNT(CASE WHEN next_retry_at <= NOW() THEN 1 END) as ready_now,
        AVG(attempts) as avg_attempts,
        MIN(created_at) as oldest_retry,
        MAX(created_at) as newest_retry
      FROM retry_queue
    `);
    
    const dlqCount = await pool.query(`
      SELECT COUNT(*) as dlq_count 
      FROM information_schema.tables 
      WHERE table_name = 'dead_letter_queue'
    `);
    
    let dlqStats = { dlq_total: 0, dlq_24h: 0 };
    if (parseInt(dlqCount.rows[0].dlq_count) > 0) {
      const dlqData = await pool.query(`
        SELECT 
          COUNT(*) as dlq_total,
          COUNT(CASE WHEN moved_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as dlq_24h
        FROM dead_letter_queue
      `);
      dlqStats = dlqData.rows[0];
    }
    
    res.json({
      retry_queue: {
        ...stats.rows[0],
        avg_attempts: parseFloat(stats.rows[0].avg_attempts || 0).toFixed(2)
      },
      dead_letter: dlqStats
    });
  } catch (error) {
    console.error('Error fetching retry stats:', error);
    res.status(500).json({ error: 'Failed to fetch retry statistics' });
  }
};

export const getDeadLetterQueue = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    // Check if dead letter queue table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'dead_letter_queue'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      return res.json({
        data: [],
        total: 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    }
    
    const result = await pool.query(`
      SELECT 
        dlq.id,
        dlq.log_id,
        dlq.final_error,
        dlq.attempts_made,
        dlq.moved_at,
        dlq.original_retry_id,
        l.source,
        l.category as event,
        l.received_at,
        SUBSTRING(l.payload::text, 1, 100) as payload_preview
      FROM dead_letter_queue dlq
      JOIN ingestion.logs l ON dlq.log_id = l.id
      ORDER BY dlq.moved_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    const countResult = await pool.query('SELECT COUNT(*) as total FROM dead_letter_queue');
    
    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching dead letter queue:', error);
    res.status(500).json({ error: 'Failed to fetch dead letter queue' });
  }
};