import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import pool from '../db.js';

const router = Router();

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

    for (const item of items) {
      // Check if we already have this item (same source_hash + title)
      if (item.source_hash) {
        const existing = await pool.query(
          `SELECT id FROM items
           WHERE user_id = $1 AND source_hash = $2 AND title = $3`,
          [userId, item.source_hash, item.title]
        );
        if (existing.rows.length > 0) {
          continue; // skip duplicate
        }
      }

      const result = await pool.query(
        `INSERT INTO items (user_id, type, title, date, time, end_time, location,
         description, urgency, category, source_hash, raw_text, people)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          userId,
          item.type || 'info',
          item.title,
          item.date || null,
          item.time || null,
          item.endTime || null,
          item.location || null,
          item.description || null,
          item.urgency || 'medium',
          item.category || 'other',
          item.source_hash || null,
          item.rawText || null,
          item.people || [],
        ]
      );
      inserted.push(result.rows[0]);
    }

    res.json({ inserted: inserted.length, items: inserted });
  } catch (err) {
    console.error('Insert items error:', err);
    res.status(500).json({ error: 'Failed to insert items' });
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
