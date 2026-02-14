import { Router } from 'express';
import * as jose from 'jose';
import pool from '../db.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

// Cache Apple's JWKS
let appleJWKS = null;

async function getAppleJWKS() {
  if (!appleJWKS) {
    appleJWKS = jose.createRemoteJWKSet(
      new URL('https://appleid.apple.com/auth/keys')
    );
  }
  return appleJWKS;
}

// POST /auth/apple
// Body: { identityToken: string, name?: string, email?: string }
router.post('/apple', async (req, res) => {
  try {
    const { identityToken, name, email } = req.body;

    if (!identityToken) {
      return res.status(400).json({ error: 'identityToken is required' });
    }

    // Verify the Apple identity token
    const jwks = await getAppleJWKS();
    const { payload } = await jose.jwtVerify(identityToken, jwks, {
      issuer: 'https://appleid.apple.com',
      // audience is your app's bundle ID — we'll validate loosely for now
    });

    const appleUserId = payload.sub;
    if (!appleUserId) {
      return res.status(400).json({ error: 'Invalid Apple token: no sub claim' });
    }

    // Apple only sends name/email on FIRST sign-in, so use them if provided
    const userName = name || null;
    const userEmail = email || payload.email || null;

    // Upsert user
    const result = await pool.query(
      `INSERT INTO users (apple_user_id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (apple_user_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             name = COALESCE(EXCLUDED.name, users.name)
       RETURNING id, apple_user_id, email, name`,
      [appleUserId, userEmail, userName]
    );

    const user = result.rows[0];

    // Sign our own JWT
    const token = signToken({
      userId: user.id,
      appleUserId: user.apple_user_id,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (err) {
    console.error('Apple auth error:', err);

    if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return res.status(401).json({ error: 'Invalid Apple identity token' });
    }

    res.status(500).json({ error: 'Authentication failed' });
  }
});

export default router;
