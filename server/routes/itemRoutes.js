import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import pool from '../db.js';

const router = Router();

const URGENCY_ORDER = { low: 0, medium: 1, high: 2 };

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

function buildCanonicalKey(item) {
  const type = item.type || 'info';
  const title = normalizeTitle(item.title || '');
  const date = compact(item.date || '');
  const time = compact(item.time || '');
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
      const dedupeKey = `${item.source_hash || 'nosource'}|${canonicalKey}`;
      if (dedupedWithinBatch.has(dedupeKey)) continue;
      dedupedWithinBatch.add(dedupeKey);

      const existing = await pool.query(
        `SELECT *
         FROM items
         WHERE user_id = $1
           AND dismissed = FALSE
           AND canonical_key = $2
         LIMIT 1`,
        [userId, canonicalKey]
      );

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
