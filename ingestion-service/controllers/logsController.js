import { pool } from '../config/db.js';
import redis from '../config/redis.js'; 
import { classifyPayload } from '../services/classifier.js';

// controllers/logsController.js - Add webhook handler
export const createLog = async (req, res) => {
  try {
    const { source, headers, payload } = req.body;
    const payloadSize = JSON.stringify(payload).length;

    // Size validation
    const maxSize = parseInt(process.env.MAX_PAYLOAD_SIZE) || 1048576; // 1MB
    if (payloadSize > maxSize) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    // Store webhook with additional metadata
    const query = `
      INSERT INTO ingestion.logs (source, headers, payload, status, size_bytes)
      VALUES ($1, $2, $3, 'received', $4)
      RETURNING id, received_at
    `;
    const result = await pool.query(query, [source, headers || {}, payload, payloadSize]);
    const log = result.rows[0];

    // Classify payload
    const category = await classifyPayload(payload, source);
    
    // Update with category
    await pool.query(
      'UPDATE ingestion.logs SET category = $1 WHERE id = $2',
      [category, log.id]
    );

    // Queue for processing - use single stream for now
    await redis.xadd(
      'webhook_events', '*',
      'log_id', log.id,
      'source', source,
      'category', category,
      'payload', JSON.stringify(payload),
      'headers', JSON.stringify(headers || {})
    );

    console.log(`Webhook ${log.id} from ${source} classified as ${category}`);

    res.status(200).json({
      status: 'success',
      id: log.id,
      received_at: log.received_at,
      category,
      message: 'Webhook received and queued for processing'
    });

  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
export const getLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, source, status, search } = req.query;
    const offset = (page - 1) * limit;

    let conditions = [];
    let values = [];

    if (source) {
      values.push(source);
      conditions.push(`source = $${values.length}`);
    }

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(payload::text ILIKE $${values.length} OR headers::text ILIKE $${values.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM ingestion.logs
      ${whereClause}
      ORDER BY received_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2};
    `;

    values.push(limit);
    values.push(offset);

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

export const getLogById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM ingestion.logs WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Log not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch log' });
  }
};

export const updateLogStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      `UPDATE ingestion.logs SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Log not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

export const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM ingestion.logs WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Log not found' });
    }

    res.json({ message: 'Log deleted', log: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete log' });
  }
};
