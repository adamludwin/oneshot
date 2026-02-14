import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import pool from '../db.js';

const router = Router();

function fallbackDashboard(items) {
  const sorted = [...items].sort((a, b) => {
    const urgencyRank = { high: 0, medium: 1, low: 2 };
    return (
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      (a.date || '').localeCompare(b.date || '') ||
      (b.occurrence_count || 0) - (a.occurrence_count || 0)
    );
  });

  const alerts = sorted
    .filter((i) => i.urgency === 'high')
    .slice(0, 5)
    .map((i) => ({
      text: i.title,
      urgency: 'high',
    }));

  const sections = [
    {
      title: 'Needs Attention',
      items: sorted.filter((i) => i.urgency === 'high').slice(0, 8),
    },
    {
      title: 'Coming Up',
      items: sorted.filter((i) => i.urgency !== 'high' && (i.type === 'event' || i.type === 'deadline')).slice(0, 12),
    },
    {
      title: 'To-Do',
      items: sorted.filter((i) => i.type === 'action').slice(0, 10),
    },
    {
      title: 'Reference',
      items: sorted.filter((i) => i.type === 'info').slice(0, 10),
    },
  ].filter((s) => s.items.length > 0);

  const summary = alerts.length > 0
    ? `You have ${alerts.length} high-priority item${alerts.length > 1 ? 's' : ''} needing attention.`
    : `You have ${sorted.length} active item${sorted.length > 1 ? 's' : ''} across your current commitments.`;

  return { summary, alerts, sections };
}

async function synthesizeDashboard(items) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.DASHBOARD_MODEL || process.env.ANALYSIS_MODEL || 'google/gemini-3-flash-preview';
  if (!apiKey || items.length === 0) {
    return fallbackDashboard(items);
  }

  const compactItems = items.map((i) => ({
    id: i.id,
    type: i.type,
    title: i.title,
    date: i.date,
    time: i.time,
    location: i.location,
    urgency: i.urgency,
    category: i.category,
    occurrenceCount: i.occurrence_count || 1,
    description: i.description,
  }));

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: `You are building a life dashboard for busy parents/professionals.

Given a list of already-deduplicated actionable items, produce a concise dashboard that helps them not miss anything important.

Return ONLY JSON with this exact shape:
{
  "summary": "1-2 sentence high signal summary",
  "alerts": [{ "text": "...", "urgency": "high" | "medium" }],
  "sections": [
    { "title": "Needs Attention", "itemIds": ["id1", "id2"] },
    { "title": "Coming Up", "itemIds": ["id3"] },
    { "title": "To-Do", "itemIds": ["id4"] },
    { "title": "Reference", "itemIds": ["id5"] }
  ]
}

Rules:
- Prioritize high urgency and near-term deadlines/events.
- Keep it concise and practical.
- Only include IDs that exist in the provided list.
- Do not invent items.
- If a section has no items, omit it.
- Alerts should be actionable and specific.`,
        },
        {
          role: 'user',
          content: JSON.stringify(compactItems),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`dashboard synthesis failed (${response.status})`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? '{}';
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);
  const byId = new Map(items.map((i) => [i.id, i]));
  const sections = (parsed.sections || [])
    .map((s) => ({
      title: s.title,
      items: (s.itemIds || []).map((id) => byId.get(id)).filter(Boolean),
    }))
    .filter((s) => s.title && s.items.length > 0);

  return {
    summary: parsed.summary || fallbackDashboard(items).summary,
    alerts: Array.isArray(parsed.alerts) ? parsed.alerts.slice(0, 6) : [],
    sections: sections.length > 0 ? sections : fallbackDashboard(items).sections,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM items
       WHERE user_id = $1
         AND dismissed = FALSE
       ORDER BY
         CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         date ASC NULLS LAST,
         last_seen_at DESC`,
      [req.user.userId]
    );

    const items = result.rows;
    if (items.length === 0) {
      return res.json({
        summary: 'No items yet. Screenshot important life updates and pull to refresh.',
        alerts: [],
        sections: [],
        itemCount: 0,
      });
    }

    let dashboard;
    try {
      dashboard = await synthesizeDashboard(items);
    } catch (err) {
      console.warn('dashboard synthesis fallback:', err.message);
      dashboard = fallbackDashboard(items);
    }

    res.json({
      ...dashboard,
      itemCount: items.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to build dashboard' });
  }
});

export default router;
