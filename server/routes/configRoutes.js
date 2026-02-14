import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/config — return config (OpenRouter key) to authenticated clients
router.get('/', requireAuth, (req, res) => {
  res.json({
    openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
    analysisModel: process.env.ANALYSIS_MODEL || 'google/gemini-3-flash-preview',
    dashboardModel: process.env.DASHBOARD_MODEL || process.env.ANALYSIS_MODEL || 'google/gemini-3-flash-preview',
  });
});

export default router;
