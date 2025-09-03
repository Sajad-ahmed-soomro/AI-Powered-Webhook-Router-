import { fetchStats, fetchCategoryDistribution, fetchRecentEvents } from "../services/analyticsService.js";

export async function getStats(req, res) {
  try {
    const data = await fetchStats();
    res.json(data);
  } catch (err) {
    console.log("error");
    res.status(500).json({ error: err.message });
  }
}

export async function getCategoryDistribution(req, res) {
  try {
    const data = await fetchCategoryDistribution();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRecentEvents(req, res) {
  try {
    const useRedis = req.query.realtime === "true"; // ?realtime=true
    const category = req.query.category || null;
    const data = await fetchRecentEvents({ category, useRedis });
    res.json(data);
  } catch (err) {
    console.log("error")
    res.status(500).json({ error: err.message });
  }
}


// controllers/analyticsController.js - Add these functions
export async function getSystemHealth(req, res) {
  try {
    const [webhookStats, processingMetrics, deliveryStats] = await Promise.all([
      fetchStats(),
      getProcessingMetrics(),
      getDeliveryStats()
    ]);

    const health = {
      timestamp: new Date().toISOString(),
      webhook_stats: webhookStats,
      processing_metrics: processingMetrics,
      delivery_stats: deliveryStats,
      status: 'healthy' // Add logic to determine overall health
    };

    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

