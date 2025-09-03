// routes/retryRoutes.js
import express from 'express';
import {
  getRetryQueue,
  retryEvent,
  moveToDeadLetter,
  getRetryStats,
  getDeadLetterQueue
} from '../controllers/retryController.js';

const router = express.Router();

// GET /api/retry-queue - Get all retry queue entries
router.get('/', getRetryQueue);

// GET /api/retry-queue/stats - Get retry queue statistics
router.get('/stats', getRetryStats);

// GET /api/retry-queue/dead-letter - Get dead letter queue entries
router.get('/dead-letter', getDeadLetterQueue);

// POST /api/retry-queue/retry - Manually retry a specific event
router.post('/retry', retryEvent);

// DELETE /api/retry-queue/:id - Move specific entry to dead letter queue
router.delete('/:id', moveToDeadLetter);

export default router;