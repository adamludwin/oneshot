import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import pool from '../db.js';

const router = Router();

function parseItemDate(item) {
  const raw = item?.date;
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const mdy = String(raw).match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (mdy) {
    const month = Number(mdy[1]) - 1;
    const day = Number(mdy[2]);
    let year = Number(mdy[3]);
    if (!year) year = new Date().getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfTomorrow() {
  const t = startOfToday();
  t.setDate(t.getDate() + 1);
  return t;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isPastEvent(item) {
  if (item?.type !== 'event') return false;
  const d = parseItemDate(item);
  if (!d) return false;
  return d < startOfToday();
}

function isOverdueDeadline(item) {
  if (item?.type !== 'deadline') return false;
  const d = parseItemDate(item);
  if (!d) return false;
  return d < startOfToday();
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isTodayItem(item) {
  const d = parseItemDate(item);
  if (!d) return false;
  return isSameDay(d, startOfToday());
}

function isTomorrowItem(item) {
  const d = parseItemDate(item);
  if (!d) return false;
  return isSameDay(d, startOfTomorrow());
}

function isFutureItem(item) {
  const d = parseItemDate(item);
  if (!d) return false;
  return d > startOfTomorrow();
}

function classifyDefaultSection(item) {
  if (isPastEvent(item)) return null;
  if (isTodayItem(item)) return 'Today';
  if (isTomorrowItem(item)) return 'Tomorrow';
  if (isFutureItem(item) && (item.type === 'event' || item.type === 'deadline')) return 'Coming Up';
  if (item.type === 'action') return 'To-dos';
  if (item.type === 'deadline' && isOverdueDeadline(item)) return 'To-dos';
  if (item.type === 'deadline') return 'Coming Up';
  return 'Other';
}

function mapSectionTitle(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('today')) return 'Today';
  if (t.includes('tomorrow')) return 'Tomorrow';
  if (t.includes('coming up') || t.includes('upcoming') || t.includes('this week')) return 'Coming Up';
  if (t.includes('to-do') || t.includes('todo') || t.includes('task') || t.includes('action')) return 'To-dos';
  if (t.includes('other') || t.includes('reference') || t.includes('info')) return 'Other';
  return null;
}

function buildAlertsFromSections(sections, limit = 6) {
  const today = sections.find((s) => s.title === 'Today')?.items || [];
  const tomorrow = sections.find((s) => s.title === 'Tomorrow')?.items || [];
  const todos = sections.find((s) => s.title === 'To-dos')?.items || [];
  const alertItems = [...today, ...tomorrow, ...todos.filter((i) => i.urgency === 'high')];

  const seen = new Set();
  const alerts = [];
  for (const item of alertItems) {
    const key = item.id || `${item.title}|${item.date || ''}|${item.time || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const when = [item.date, item.time].filter(Boolean).join(' ');
    alerts.push({
      text: when ? `${item.title} (${when})` : item.title,
      urgency: item.urgency === 'high' ? 'high' : 'medium',
    });
    if (alerts.length >= limit) break;
  }
  return alerts;
}

function normalizeDashboardSections(sections, allItems) {
  const order = ['Today', 'Tomorrow', 'Coming Up', 'To-dos', 'Other'];
  const buckets = new Map(order.map((key) => [key, []]));
  const seen = new Set();

  for (const section of sections) {
    if (!section?.title || !Array.isArray(section.items)) continue;
    const mappedTitle = mapSectionTitle(section.title) || 'Other';
    for (const item of section.items.filter(Boolean)) {
      const id = item.id || `${item.title}|${item.date || ''}|${item.time || ''}`;
      if (seen.has(id)) continue;
      if (isPastEvent(item)) continue;

      let target = mappedTitle;
      if (mappedTitle === 'Today' && !isTodayItem(item)) target = classifyDefaultSection(item) || 'Other';
      if (mappedTitle === 'Tomorrow' && !isTomorrowItem(item)) target = classifyDefaultSection(item) || 'Other';
      if (mappedTitle === 'Coming Up' && (isTodayItem(item) || isTomorrowItem(item) || isOverdueDeadline(item))) {
        target = classifyDefaultSection(item) || 'Other';
      }
      if (target === 'Coming Up' && isOverdueDeadline(item)) target = 'To-dos';

      seen.add(id);
      buckets.get(target)?.push(item);
    }
  }

  // Ensure items omitted by model still appear in a reasonable section.
  for (const item of allItems) {
    const id = item.id || `${item.title}|${item.date || ''}|${item.time || ''}`;
    if (seen.has(id) || isPastEvent(item)) continue;
    const target = classifyDefaultSection(item);
    if (!target) continue;
    buckets.get(target)?.push(item);
    seen.add(id);
  }

  return order
    .map((title) => ({ title, items: dedupeById(buckets.get(title) || []) }))
    .filter((section) => section.items.length > 0);
}

function fallbackDashboard(items) {
  const sorted = [...items].sort((a, b) => {
    const urgencyRank = { high: 0, medium: 1, low: 2 };
    return (
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      (a.date || '').localeCompare(b.date || '') ||
      (b.occurrence_count || 0) - (a.occurrence_count || 0)
    );
  });

  const sections = [
    {
      title: 'Today',
      items: sorted.filter((i) => isTodayItem(i) && !isPastEvent(i)).slice(0, 10),
    },
    {
      title: 'Tomorrow',
      items: sorted
        .filter((i) => isTomorrowItem(i) && !isPastEvent(i))
        .slice(0, 10),
    },
    {
      title: 'Coming Up',
      items: sorted
        .filter((i) => isFutureItem(i) && (i.type === 'event' || i.type === 'deadline'))
        .filter((i) => !isPastEvent(i) && !isOverdueDeadline(i))
        .slice(0, 12),
    },
    {
      title: 'To-dos',
      items: sorted.filter((i) => i.type === 'action' || isOverdueDeadline(i)).slice(0, 10),
    },
    {
      title: 'Other',
      items: sorted.filter((i) => i.type === 'info').slice(0, 10),
    },
  ].filter((s) => s.items.length > 0);
  const normalizedSections = normalizeDashboardSections(sections, sorted);
  const alerts = buildAlertsFromSections(normalizedSections, 5);

  const summary = alerts.length > 0
    ? `You have ${alerts.length} key item${alerts.length > 1 ? 's' : ''} to keep in mind today/tomorrow.`
    : `You have ${sorted.length} active item${sorted.length > 1 ? 's' : ''} across your current commitments.`;

  return { summary, alerts, sections: normalizedSections };
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
    { "title": "Today", "itemIds": ["id1", "id2"] },
    { "title": "Tomorrow", "itemIds": ["id3"] },
    { "title": "Coming Up", "itemIds": ["id3"] },
    { "title": "To-dos", "itemIds": ["id4"] },
    { "title": "Other", "itemIds": ["id5"] }
  ]
}

Rules:
- Prioritize near-term deadlines/events, but DO NOT create a generic "Needs Attention" bucket.
- Put items in these sections only: Today, Tomorrow, Coming Up, To-dos, Other.
- "Today" = dated for today. "Tomorrow" = dated for tomorrow.
- "Coming Up" = future after tomorrow.
- "To-dos" = action items / follow-ups / overdue deadlines.
- "Other" = likely important but unclear how to classify.
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
  const normalizedSections = normalizeDashboardSections(sections, items);

  const modelAlerts = Array.isArray(parsed.alerts) ? parsed.alerts.slice(0, 6) : [];
  const fallback = fallbackDashboard(items);
  const deterministicAlerts = buildAlertsFromSections(normalizedSections, 6);

  return {
    summary: parsed.summary || fallbackDashboard(items).summary,
    // Prefer deterministic alerts from normalized sections so stale past events
    // cannot appear in top banners even if model text mentions them.
    alerts: deterministicAlerts.length > 0 ? deterministicAlerts : modelAlerts,
    sections: normalizedSections.length > 0 ? normalizedSections : fallback.sections,
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
    const displayItems = items.filter((item) => !isPastEvent(item));
    if (displayItems.length === 0) {
      return res.json({
        summary: 'No items yet. Screenshot important life updates and pull to refresh.',
        alerts: [],
        sections: [],
        items: [],
        itemCount: 0,
      });
    }

    let dashboard;
    try {
      dashboard = await synthesizeDashboard(displayItems);
    } catch (err) {
      console.warn('dashboard synthesis fallback:', err.message);
      dashboard = fallbackDashboard(displayItems);
    }

    res.json({
      ...dashboard,
      items: displayItems,
      itemCount: displayItems.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to build dashboard' });
  }
});

export default router;
