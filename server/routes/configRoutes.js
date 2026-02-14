import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/config — return config (OpenRouter key) to authenticated clients
router.get('/', requireAuth, (req, res) => {
  res.json({
    openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
    analysisModel: 'google/gemini-2.0-flash-001',
  });
});

export default router;
