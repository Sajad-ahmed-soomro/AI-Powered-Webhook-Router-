import express from 'express';
import {
  createLog,
  getLogs,
  getLogById,
  updateLogStatus,
  deleteLog
} from '../controllers/logsController.js';

const router = express.Router();

router.post('/', createLog);
router.get('/', getLogs);        
router.get('/:id', getLogById);  
router.patch('/:id/status', updateLogStatus); 
router.delete('/:id', deleteLog); 

export default router;
