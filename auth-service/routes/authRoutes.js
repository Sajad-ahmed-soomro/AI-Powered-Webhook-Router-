import express from 'express';
import { createUser,loginUser,createApiKey,getUserApiKeys,revokeApiKey } from '../controllers/authController.js';
import requireAuth from '../middleware/auth.js';
const router=express.Router();

router.post("/signup",createUser);
router.post("/login",loginUser);

router.post('/api-keys',requireAuth, createApiKey);
router.get('/api-keys',requireAuth,getUserApiKeys);
router.delete('/api-keys/:keyId', requireAuth, revokeApiKey);

export default router;