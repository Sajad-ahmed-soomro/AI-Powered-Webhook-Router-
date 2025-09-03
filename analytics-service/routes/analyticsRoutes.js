import express from "express";
import { getStats, getCategoryDistribution, getRecentEvents } from "../controllers/analyticsController.js";

const router = express.Router();

router.get("/stats", getStats);
router.get("/categories/distribution", getCategoryDistribution);
router.get("/events/recent", getRecentEvents);

export default router;
