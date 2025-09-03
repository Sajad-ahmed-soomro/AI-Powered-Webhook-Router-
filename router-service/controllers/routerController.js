import { readFromStream } from '../services/queueService.js';
import { deliverToDestinations } from '../services/deliveryService.js';



// controllers/routingController.js - New file
import { pool } from '../config/db.js';

export const createRoutingRule = async (req, res) => {
  try {
    const { name, source, destination_url, category, transform_script, conditions } = req.body;
    
    const result = await pool.query(`
      INSERT INTO routing_rules (name, source, destination_url, category, transform_script, conditions)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [name, source, destination_url, category, transform_script, JSON.stringify(conditions || {})]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create routing rule error:', err);
    res.status(500).json({ error: 'Failed to create routing rule' });
  }
};

export const getRoutingRules = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *, 
        (SELECT COUNT(*) FROM delivery_logs dl WHERE dl.rule_id = routing_rules.id) as delivery_count
      FROM routing_rules 
      ORDER BY created_at DESC
    `);
    console.log(result.rows)
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routing rules' });
  }
};

export const getDeliveryLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = '';
    let values = [];
    
    if (status) {
      whereClause = 'WHERE dl.status = $1';
      values.push(status);
    }
    
    const result = await pool.query(`
      SELECT dl.*, il.source, rr.name as rule_name
      FROM delivery_logs dl
      JOIN ingestion.logs il ON dl.log_id = il.id
      LEFT JOIN routing_rules rr ON dl.rule_id = rr.id
      ${whereClause}
      ORDER BY dl.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `, [...values, limit, offset]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch delivery logs' });
  }
};
export async function processLogs(req, res) {
  try {
    const { category } = req.params;
    const streamName = `stream_${category}`;

    const logs = await readFromStream(streamName);

    for (const log of logs) {
      await deliverToDestinations(log);
    }

    res.json({ message: "Processed logs", count: logs.length });
  } catch (err) {
    console.error("Router error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
