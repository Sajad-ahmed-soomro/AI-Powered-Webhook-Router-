// services/deliveryService.js - Complete rewrite
import fetch from 'node-fetch';
import { pool } from '../config/db.js';

export async function processRoutingQueue() {
  try {
    const result = await redis.xreadgroup(
      'GROUP', 'routing_group', 'router_1',
      'BLOCK', 5000, 'COUNT', 10,
      'STREAMS', 'routing_queue', '>'
    );

    if (!result) return;

    for (const [streamName, entries] of result) {
      for (const [id, fields] of entries) {
        const data = JSON.parse(fields[1]);
        await deliverWebhook(data);
        await redis.xack('routing_queue', 'routing_group', id);
      }
    }
  } catch (err) {
    console.error('Routing queue processing error:', err);
  }
}

export async function deliverToDestinations(data) {
  const { log_id, destination_url, payload, transform_script, rule_id } = data;
  
  // Create delivery log
  const deliveryResult = await pool.query(`
    INSERT INTO delivery_logs (log_id, rule_id, destination_url, status) 
    VALUES ($1, $2, $3, 'attempting') RETURNING id
  `, [log_id, rule_id, destination_url]);
  
  const deliveryId = deliveryResult.rows[0].id;

  try {
    // Apply transformation if script exists
    let transformedPayload = payload;
    if (transform_script) {
      transformedPayload = applyTransform(payload, transform_script);
    }

    // Send webhook
    const response = await fetch(destination_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WebRouter/1.0'
      },
      body: JSON.stringify(transformedPayload),
      timeout: 10000
    });

    // Update delivery log
    await pool.query(`
      UPDATE delivery_logs 
      SET status = $1, response_code = $2, response_body = $3, delivered_at = NOW()
      WHERE id = $4
    `, [
      response.ok ? 'delivered' : 'failed',
      response.status,
      await response.text(),
      deliveryId
    ]);

    console.log(`Delivered webhook ${log_id} to ${destination_url}: ${response.status}`);

  } catch (err) {
    // Mark as failed and increment attempts
    await pool.query(`
      UPDATE delivery_logs 
      SET status = 'failed', attempts = attempts + 1, error_message = $1
      WHERE id = $2
    `, [err.message, deliveryId]);

    console.error(`Failed to deliver webhook ${log_id}:`, err.message);
  }
}

function applyTransform(payload, script) {
  try {
    // Simple transformation - in production, use a sandbox
    const transformFunction = new Function('payload', `return ${script}`);
    return transformFunction(payload);
  } catch (err) {
    console.error('Transform error:', err);
    return payload;
  }
}