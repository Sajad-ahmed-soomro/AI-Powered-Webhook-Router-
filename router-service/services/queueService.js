import {pool} from '../config/db.js';
import { routeEvent } from '../controllers/routerController.js';

export async function startQueueConsumer() {
  console.log('Queue consumer started...');
  setInterval(async () => {
    const { rows } = await pool.query(
      `SELECT * FROM ingestion.logs WHERE status = 'pending' LIMIT 5`
    );
    for (const log of rows) {
      await routeEvent(log);
    }
  }, 5000); // every 5 seconds
}
