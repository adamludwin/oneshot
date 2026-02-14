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
      date TEXT,
      time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('high', 'medium', 'low')),
      category TEXT NOT NULL DEFAULT 'other',
      source_hash TEXT,
      raw_text TEXT,
      people TEXT[] DEFAULT '{}',
      dismissed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_source_hash ON items(source_hash);
  `);

  console.log('  ✓ database tables ready');
}
