// services/classifier.js - Enhanced version
import { InferenceClient } from "@huggingface/inference";

const hf = new InferenceClient({ apiKey: process.env.HF_TOKEN });

const CATEGORY_KEYWORDS = {
  payment: ['payment', 'charge', 'invoice', 'billing', 'subscription', 'refund'],
  deployment: ['deploy', 'build', 'release', 'pipeline', 'ci/cd'],
  alert: ['error', 'warning', 'alert', 'critical', 'failure'],
  notification: ['notification', 'message', 'email', 'sms'],
  general: ['update', 'sync', 'data', 'info']
};

export async function classifyPayload(payload, source = '') {
  try {
    const text = `${source} ${JSON.stringify(payload)}`.substring(0, 512);
    const categories = Object.keys(CATEGORY_KEYWORDS);

    // Try AI classification
    const result = await hf.zeroShotClassification({
      inputs: text,
      parameters: { candidate_labels: categories },
      model: "facebook/bart-large-mnli"
    });

    const aiCategory = result.labels[0];
    const confidence = result.scores[0];

    // Use AI result if confidence is high
    if (confidence > 0.5) {
      return aiCategory;
    }

    // Fallback to keyword matching
    const keywordCategory = classifyByKeywords(text.toLowerCase());
    return keywordCategory || 'general';

  } catch (error) {
    console.error("Classification error:", error);
    return classifyByKeywords(`${source} ${JSON.stringify(payload)}`.toLowerCase());
  }
}

function classifyByKeywords(text) {
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return category;
    }
  }
  return 'general';
}