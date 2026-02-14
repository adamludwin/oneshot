import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      apple_user_id TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('event', 'deadline', 'action', 'info')),
      title TEXT NOT NULL,
      normalized_title TEXT,
      canonical_key TEXT,
      date TEXT,
      time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('high', 'medium', 'low')),
      category TEXT NOT NULL DEFAULT 'other',
      source_hash TEXT,
      source_hashes TEXT[] DEFAULT '{}',
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      raw_text TEXT,
      people TEXT[] DEFAULT '{}',
      dismissed BOOLEAN DEFAULT FALSE,
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE items ADD COLUMN IF NOT EXISTS normalized_title TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS canonical_key TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS source_hashes TEXT[] DEFAULT '{}';
    ALTER TABLE items ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE items
    SET source_hashes = CASE
      WHEN source_hash IS NULL OR source_hash = '' THEN '{}'
      ELSE ARRAY[source_hash]
    END
    WHERE source_hashes IS NULL OR array_length(source_hashes, 1) IS NULL;

    UPDATE items
    SET occurrence_count = GREATEST(COALESCE(array_length(source_hashes, 1), 0), 1)
    WHERE occurrence_count IS NULL OR occurrence_count < 1;

    CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_source_hash ON items(source_hash);
    CREATE INDEX IF NOT EXISTS idx_items_canonical_key ON items(user_id, canonical_key);
    CREATE INDEX IF NOT EXISTS idx_items_last_seen ON items(user_id, last_seen_at DESC);
  `);

  console.log('  ✓ database tables ready');
}
