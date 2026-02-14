import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDB } from './db.js';
import authRoutes from './routes/authRoutes.js';
import configRoutes from './routes/configRoutes.js';
import itemRoutes from './routes/itemRoutes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─── Routes ───────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/items', itemRoutes);

// ─── Start ────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await initDB();
  } catch (err) {
    console.warn('  ⚠ database init skipped:', err.message);
    console.warn('    (set DATABASE_URL in .env to enable persistence)');
  }

  app.listen(PORT, () => {
    console.log(`\n  oneshot API running on http://localhost:${PORT}`);
    console.log(`  endpoints:`);
    console.log(`    POST /auth/apple`);
    console.log(`    GET  /api/config`);
    console.log(`    GET  /api/items`);
    console.log(`    POST /api/items`);
    console.log(`    DELETE /api/items/:id\n`);
  });
}

start();
