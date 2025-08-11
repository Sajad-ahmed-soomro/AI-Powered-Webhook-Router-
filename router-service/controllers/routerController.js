import {pool} from '../config/db.js';
import { deliverToDestinations } from '../services/deliveryService.js';

export async function routeEvent(log) {
  try {
    const { rows: rules } = await pool.query(
      'SELECT * FROM routing_rules WHERE source = $1',
      [log.source]
    );

    if (!rules.length) {
      console.warn(`No routing rule for source: ${log.source}`);
      return;
    }

    await deliverToDestinations(log.payload, rules);

    await db.query(
      `UPDATE ingestion.logs SET status = 'processed' WHERE id = $1`,
      [log.id]
    );
  } catch (err) {
    console.error('Routing failed:', err.message);
    await db.query(
      `INSERT INTO retry_queue (log_id, error_message) VALUES ($1, $2)`,
      [log.id, err.message]
    );
  }
}
