import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import redis from './config/redis.js';
import pool from './config/db.js';

import { startConsumerLoop } from './services/consumer.js';
import { startRetryProcessor } from './services/retryProcessor.js';


const PORT = process.env.PORT || 4100;

const server = app.listen(PORT, async () => {
  console.log(`Processing service listening on ${PORT}`);
  startConsumerLoop().catch((err) => {
    console.error('Failed to start consumer', err);
    process.exit(1);
  });
  startRetryProcessor().catch(console.error);
});

// graceful shutdown
async function shutdown() {
  console.log('Shutting down...');
  await redis.quit();
  await pool.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
