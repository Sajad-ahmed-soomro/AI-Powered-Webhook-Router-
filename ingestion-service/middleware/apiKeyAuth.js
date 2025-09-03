// middleware/apiKeyAuth.js
import crypto from 'crypto';
import { pool } from '../config/db.js';

export const validateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await pool.query(
      `UPDATE api_keys 
       SET last_used_at = NOW() 
       WHERE key_hash = $1 AND is_active = true 
       RETURNING user_id, permissions`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.apiKey = result.rows[0];
    next();
  } catch (err) {
    console.error('API key validation error:', err);
    res.status(500).json({ error: 'Authentication error' });
  }
};