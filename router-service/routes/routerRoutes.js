import {createRoutingRule,getRoutingRules} from '../controllers/routerController.js'

import express from 'express'

const router=express.Router();

router.post("/",createRoutingRule);
router.get("/",getRoutingRules);

export default router;