import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import pool from '../db.js';

const router = Router();

const URGENCY_ORDER = { low: 0, medium: 1, high: 2 };
const DEDUPE_MODEL = 'anthropic/claude-opus-4.6';
const DEDUPE_CONFIDENCE_THRESHOLD = 0.72;

function normalizeText(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeTitle(title) {
  return normalizeText(title)
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value) {
  return normalizeText(value || '').replace(/\s+/g, '');
}

function normalizeDateKey(value) {
  if (!value) return '';
  const raw = String(value).trim();

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    const y = direct.getFullYear();
    const m = String(direct.getMonth() + 1).padStart(2, '0');
    const d = String(direct.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const mdy = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (mdy) {
    const month = String(Number(mdy[1])).padStart(2, '0');
    const day = String(Number(mdy[2])).padStart(2, '0');
    let year = Number(mdy[3] || new Date().getFullYear());
    if (year < 100) year += 2000;
    return `${year}-${month}-${day}`;
  }

  return compact(raw);
}

function normalizeTimeKey(value) {
  if (!value) return '';
  const raw = String(value).toLowerCase().trim().replace(/\./g, '');
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return compact(raw);

  let hour = Number(m[1]);
  const minute = Number(m[2] || '0');
  const ampm = m[3];

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildLooseTemporalKey(item) {
  const type = item.type || 'info';
  const title = normalizeTitle(item.title || '');
  const date = normalizeDateKey(item.date || '');
  const time = normalizeTimeKey(item.time || '');
  return `${type}|${title}|${date}|${time}`;
}

function buildCanonicalKey(item) {
  const type = item.type || 'info';
  const title = normalizeTitle(item.title || '');
  const date = normalizeDateKey(item.date || '');
  const time = normalizeTimeKey(item.time || '');
  const location = compact(item.location || '');
  return `${type}|${title}|${date}|${time}|${location}`;
}

function pickUrgency(a, b) {
  return URGENCY_ORDER[a] >= URGENCY_ORDER[b] ? a : b;
}

function isLikelyRelevant(item) {
  if (!item?.title || String(item.title).trim().length < 3) return false;
  const type = item.type || 'info';
  const hasTimeSignal = Boolean(item.date || item.time || item.endTime || item.location);
  const desc = normalizeText(item.description || '');
  const actionSignals = /(due|deadline|register|registration|payment|pay|submit|bring|rsvp|pick up|drop off|meeting|practice|game|flight|trip|appointment|call|follow up|follow-up)/;
  if (type === 'event' || type === 'deadline') {
    return hasTimeSignal || actionSignals.test(desc);
  }
  if (type === 'action') {
    return actionSignals.test(`${normalizeText(item.title)} ${desc}`) || hasTimeSignal;
  }
  return hasTimeSignal && actionSignals.test(`${normalizeText(item.title)} ${desc}`);
}

function toCandidateForLLM(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    date: row.date,
    time: row.time,
    endTime: row.end_time,
    location: row.location,
    description: row.description,
    category: row.category,
    urgency: row.urgency,
    occurrenceCount: row.occurrence_count || 1,
    lastSeenAt: row.last_seen_at,
  };
}

async function resolveDuplicateWithLLM({ item, candidates }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const payload = {
    newItem: {
      type: item.type || 'info',
      title: item.title || '',
      date: item.date || null,
      time: item.time || null,
      endTime: item.endTime || null,
      location: item.location || null,
      description: item.description || null,
      category: item.category || 'other',
      urgency: item.urgency || 'medium',
      people: item.people || [],
    },
    candidates,
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEDUPE_MODEL,
      temperature: 0,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `You are a strict deduplication resolver for family life dashboard items.

Decide if NEW_ITEM is the same real-world obligation as one of CANDIDATES.
Same means: identical event/deadline/action despite wording, screenshot frame, or formatting differences.
Not same means: different occurrence/day/time/person/activity.

Return ONLY JSON:
{
  "mergeWithId": "<candidate id>" | null,
  "confidence": 0.0-1.0,
  "reason": "short reason"
}

Rules:
- If uncertain, choose null.
- Never invent IDs; mergeWithId must be from candidates or null.
- Prefer precision over recall.`,
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM dedupe failed (${response.status})`);
  }

  const data = await response.json();
  let content = data?.choices?.[0]?.message?.content || '{}';
  content = content.trim();
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  const parsed = JSON.parse(content);

  const mergeWithId = parsed?.mergeWithId || null;
  const confidence = Number(parsed?.confidence || 0);

  if (!mergeWithId) return null;
  if (!Number.isFinite(confidence) || confidence < DEDUPE_CONFIDENCE_THRESHOLD) return null;
  if (!candidates.some((c) => c.id === mergeWithId)) return null;

  return { mergeWithId, confidence };
}

async function detachSourceFromExistingItems(userId, sourceHash) {
  const existing = await pool.query(
    `SELECT id, source_hashes
     FROM items
     WHERE user_id = $1
       AND dismissed = FALSE
       AND $2 = ANY(source_hashes)`,
    [userId, sourceHash]
  );

  for (const row of existing.rows) {
    const nextSourceHashes = (row.source_hashes || []).filter((s) => s !== sourceHash);
    if (nextSourceHashes.length === 0) {
      await pool.query(
        `UPDATE items
         SET dismissed = TRUE,
             occurrence_count = 0,
             last_seen_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
    } else {
      await pool.query(
        `UPDATE items
         SET source_hashes = $2,
             occurrence_count = $3,
             last_seen_at = NOW()
         WHERE id = $1`,
        [row.id, nextSourceHashes, nextSourceHashes.length]
      );
    }
  }
}

// GET /api/items — fetch all non-dismissed items for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM items
       WHERE user_id = $1 AND dismissed = FALSE
       ORDER BY
         CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         date ASC NULLS LAST,
         created_at DESC`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch items error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// POST /api/items — bulk upsert items (dedupe by source_hash + title)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const userId = req.user.userId;
    const inserted = [];
    const dedupedWithinBatch = new Set();
    const llmResolutionCache = new Map();
    const sourceHashes = [...new Set(items.map((i) => i.source_hash).filter(Boolean))];

    // Re-analysis behavior: source is authoritative for that screenshot.
    // Remove old references from each source hash before inserting fresh results.
    for (const sourceHash of sourceHashes) {
      await detachSourceFromExistingItems(userId, sourceHash);
    }

    for (const item of items) {
      if (!isLikelyRelevant(item)) continue;

      const normalizedTitle = normalizeTitle(item.title);
      const canonicalKey = buildCanonicalKey(item);
      const looseTemporalKey = buildLooseTemporalKey(item);
      const dedupeKey = `${item.source_hash || 'nosource'}|${looseTemporalKey}`;
      if (dedupedWithinBatch.has(dedupeKey)) continue;
      dedupedWithinBatch.add(dedupeKey);

      let existing = await pool.query(
        `SELECT *
         FROM items
         WHERE user_id = $1
           AND dismissed = FALSE
           AND canonical_key = $2
         LIMIT 1`,
        [userId, canonicalKey]
      );

      // Fallback dedupe: same event/task title + normalized date/time, even if
      // one extraction missed location or formatted date/time differently.
      if (existing.rows.length === 0) {
        const candidates = await pool.query(
          `SELECT *
           FROM items
           WHERE user_id = $1
             AND dismissed = FALSE
             AND type = $2
             AND normalized_title = $3
           ORDER BY last_seen_at DESC
           LIMIT 20`,
          [userId, item.type || 'info', normalizedTitle || null]
        );

        const matched = candidates.rows.find((row) => {
          const rowLooseKey = buildLooseTemporalKey({
            type: row.type,
            title: row.title,
            date: row.date,
            time: row.time,
          });
          return rowLooseKey === looseTemporalKey;
        });

        if (matched) {
          existing = { rows: [matched] };
        }
      }

      // LLM-assisted entity resolution when deterministic checks miss.
      if (existing.rows.length === 0) {
        const resolutionKey = `${item.type || 'info'}|${normalizedTitle}|${normalizeDateKey(item.date || '')}|${normalizeTimeKey(item.time || '')}`;

        let mergeIdFromLLM = llmResolutionCache.get(resolutionKey) || null;
        if (mergeIdFromLLM === undefined) mergeIdFromLLM = null;

        if (!mergeIdFromLLM && !llmResolutionCache.has(resolutionKey)) {
          const candidateRows = await pool.query(
            `SELECT *
             FROM items
             WHERE user_id = $1
               AND dismissed = FALSE
               AND type = $2
               AND (
                 normalized_title = $3
                 OR date = $4
                 OR time = $5
               )
             ORDER BY occurrence_count DESC, last_seen_at DESC
             LIMIT 30`,
            [
              userId,
              item.type || 'info',
              normalizedTitle || null,
              item.date || null,
              item.time || null,
            ]
          );

          if (candidateRows.rows.length > 0) {
            try {
              const llmDecision = await resolveDuplicateWithLLM({
                item,
                candidates: candidateRows.rows.map(toCandidateForLLM),
              });
              mergeIdFromLLM = llmDecision?.mergeWithId || null;
              llmResolutionCache.set(resolutionKey, mergeIdFromLLM);
            } catch (err) {
              // Keep ingestion resilient if LLM call fails.
              console.warn('LLM dedupe skipped:', err.message);
              llmResolutionCache.set(resolutionKey, null);
            }
          } else {
            llmResolutionCache.set(resolutionKey, null);
          }
        }

        if (mergeIdFromLLM) {
          const matchedById = await pool.query(
            `SELECT *
             FROM items
             WHERE id = $1
               AND user_id = $2
               AND dismissed = FALSE
             LIMIT 1`,
            [mergeIdFromLLM, userId]
          );
          if (matchedById.rows.length > 0) {
            existing = { rows: [matchedById.rows[0]] };
          }
        }
      }

      if (existing.rows.length > 0) {
        const prev = existing.rows[0];
        const mergedHashes = [...new Set([...(prev.source_hashes || []), ...(item.source_hash ? [item.source_hash] : [])])];
        const mergedPeople = [...new Set([...(prev.people || []), ...((item.people || []).filter(Boolean))])];
        const nextUrgency = pickUrgency(prev.urgency || 'medium', item.urgency || 'medium');
        const nextDescription =
          (item.description || '').length >= (prev.description || '').length
            ? item.description || prev.description
            : prev.description;

        const updated = await pool.query(
          `UPDATE items
           SET description = $2,
               urgency = $3,
               date = COALESCE($4, date),
               time = COALESCE($5, time),
               end_time = COALESCE($6, end_time),
               location = COALESCE($7, location),
               category = COALESCE($8, category),
               raw_text = COALESCE($9, raw_text),
               people = $10,
               source_hash = COALESCE($11, source_hash),
               source_hashes = $12,
               occurrence_count = $13,
               last_seen_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            prev.id,
            nextDescription || null,
            nextUrgency,
            item.date || null,
            item.time || null,
            item.endTime || null,
            item.location || null,
            item.category || prev.category || 'other',
            item.rawText || null,
            mergedPeople,
            item.source_hash || null,
            mergedHashes,
            mergedHashes.length || 1,
          ]
        );
        inserted.push(updated.rows[0]);
        continue;
      }

      const sourceHashesForInsert = item.source_hash ? [item.source_hash] : [];
      const result = await pool.query(
        `INSERT INTO items (
           user_id, type, title, normalized_title, canonical_key, date, time, end_time, location,
           description, urgency, category, source_hash, source_hashes, occurrence_count, raw_text, people, last_seen_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
         RETURNING *`,
        [
          userId,
          item.type || 'info',
          item.title,
          normalizedTitle || null,
          canonicalKey,
          item.date || null,
          item.time || null,
          item.endTime || null,
          item.location || null,
          item.description || null,
          item.urgency || 'medium',
          item.category || 'other',
          item.source_hash || null,
          sourceHashesForInsert,
          sourceHashesForInsert.length || 1,
          item.rawText || null,
          item.people || [],
        ]
      );
      inserted.push(result.rows[0]);
    }

    res.json({
      inserted: inserted.length,
      items: inserted,
      processed: items.length,
      sourcesReconciled: sourceHashes.length,
    });
  } catch (err) {
    console.error('Insert items error:', err);
    res.status(500).json({ error: 'Failed to insert items' });
  }
});

// POST /api/items/reset — clear active cards and reset state for user
router.post('/reset', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE items
       SET dismissed = TRUE,
           occurrence_count = 0,
           source_hashes = '{}',
           last_seen_at = NOW()
       WHERE user_id = $1
         AND dismissed = FALSE`,
      [req.user.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset items error:', err);
    res.status(500).json({ error: 'Failed to reset items' });
  }
});

// DELETE /api/items/:id — dismiss an item (soft delete)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE items SET dismissed = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ dismissed: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Failed to dismiss item' });
  }
});

export default router;
