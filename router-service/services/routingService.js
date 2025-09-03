// services/routingService.js - New file
import { pool } from '../config/db.js';
import redis from '../config/redis.js';

export async function routeProcessedMessage(logId, category, source, result) {
  try {
    // Get routing rules for this category/source
    const rules = await pool.query(`
      SELECT * FROM routing_rules 
      WHERE (source = $1 OR source IS NULL) 
      AND is_active = true
    `, [source]);

    if (rules.rows.length === 0) {
      console.log(`No routing rules found for source: ${source}`);
      return;
    }

    // Send to routing queues
    for (const rule of rules.rows) {
      const routingData = {
        log_id: logId,
        source,
        category,
        destination_url: rule.destination_url,
        payload: result.enriched,
        transform_script: rule.transform_script,
        rule_id: rule.id
      };

      await redis.xadd(
        'routing_queue', '*',
        'data', JSON.stringify(routingData)
      );

      console.log(`Routed log ${logId} to ${rule.destination_url}`);
    }
  } catch (err) {
    console.error('Routing error:', err);
    throw err;
  }
}