import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { startConsumerLoop } from './services/consumer.js';
import redis from './config/redis.js';
import db from './config/db.js';

const PORT = process.env.PORT || 4100;

const server = app.listen(PORT, async () => {
  console.log(`Processing service listening on ${PORT}`);
  startConsumerLoop().catch((err) => {
    console.error('Failed to start consumer', err);
    process.exit(1);
  });
});

// graceful shutdown
async function shutdown() {
  console.log('Shutting down...');
  await redis.quit();
  await db.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
