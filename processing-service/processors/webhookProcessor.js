// processors/webhookProcessor.js - Updated version
import pool from '../config/db.js';

export async function processPayload(payload, category = 'general', source = '') {
  const startTime = Date.now();
  
  try {
    let enrichedPayload = { ...payload };
    
    // Category-specific processing
    switch (category) {
      case 'payment':
        enrichedPayload = await processPaymentWebhook(payload);
        break;
      case 'deployment':
        enrichedPayload = await processDeploymentWebhook(payload);
        break;
      case 'alert':
        enrichedPayload = await processAlertWebhook(payload);
        break;
      default:
        enrichedPayload = await processGenericWebhook(payload);
    }
    
    const processingTime = Date.now() - startTime;
    
    return {
      original: payload,
      enriched: enrichedPayload,
      metadata: {
        category,
        source,
        processing_time_ms: processingTime,
        processed_at: new Date().toISOString(),
        payload_size: JSON.stringify(payload).length
      }
    };
    
  } catch (err) {
    console.error('Processing error:', err);
    throw err;
  }
}

async function processPaymentWebhook(payload) {
  return {
    ...payload,
    processed_type: 'payment',
    amount_cents: payload.amount ? Math.round(payload.amount * 100) : null,
    currency: payload.currency || 'USD',
    risk_score: calculateBasicRiskScore(payload)
  };
}

async function processDeploymentWebhook(payload) {
  return {
    ...payload,
    processed_type: 'deployment',
    environment: extractEnvironment(payload),
    deployment_status: payload.status || payload.state,
    commit_sha: payload.sha || payload.commit?.sha
  };
}

async function processAlertWebhook(payload) {
  return {
    ...payload,
    processed_type: 'alert',
    severity: determineSeverity(payload),
    alert_type: payload.alert_type || 'general',
    timestamp: payload.timestamp || new Date().toISOString()
  };
}

async function processGenericWebhook(payload) {
  return {
    ...payload,
    processed_type: 'generic',
    processed: true
  };
}

function calculateBasicRiskScore(payload) {
  let score = 0;
  if (payload.amount > 1000) score += 0.3;
  if (payload.currency !== 'USD') score += 0.2;
  return Math.min(score, 1.0);
}

function extractEnvironment(payload) {
  const text = JSON.stringify(payload).toLowerCase();
  if (text.includes('prod')) return 'production';
  if (text.includes('stag')) return 'staging';
  if (text.includes('dev')) return 'development';
  return 'unknown';
}

function determineSeverity(payload) {
  const text = JSON.stringify(payload).toLowerCase();
  if (text.includes('critical')) return 'critical';
  if (text.includes('error')) return 'error';
  if (text.includes('warning')) return 'warning';
  return 'info';
}

export async function persistResult(logId, result) {
  try {
    console.log('Persisting result for logId:', logId, typeof logId);
    
    if (!logId) {
      throw new Error('logId is required but was null/undefined');
    }
    
    await pool.query(
      `INSERT INTO processed_results (log_id, result, processing_time_ms) 
       VALUES ($1, $2, $3)`,
      [logId, JSON.stringify(result), result.metadata?.processing_time_ms]
    );
    
    await pool.query(
      `UPDATE ingestion.logs 
       SET status = 'processed', processed_at = NOW(), category = $1 
       WHERE id = $2`,
      [result.metadata?.category, logId]
    );
    
    console.log(`Successfully persisted result for log ${logId}`);
  } catch (err) {
    console.error(`Error persisting result for log ${logId}:`, err);
    throw err;
  }
}

export async function markFailed(logId, errorMessage) {
  try {
    console.log('Marking failed for logId:', logId, typeof logId);
    
    if (!logId) {
      throw new Error('logId is required but was null/undefined');
    }
    
    // Only update status and processed_at (removed error_message since column doesn't exist)
    await pool.query(
      `UPDATE ingestion.logs 
       SET status = 'failed', processed_at = NOW()
       WHERE id = $1`,
      [logId]
    );
    
    console.log(`Successfully marked log ${logId} as failed`);
  } catch (err) {
    console.error(`Error marking log ${logId} as failed:`, err);
    throw err;
  }
}