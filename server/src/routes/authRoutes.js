import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateTokens, REFRESH_COOKIE_OPTIONS } from '../utils/tokens.js';
import { verifyAuth } from '../middleware/auth.js';

const router = express.Router();

// Mock persistence (Replace with DB collections/tables)
const users = [];
// Maps token string -> userId
let refreshTokensDB = new Set();

// Fixed demo credentials
const DEMO_USER = {
  id: 'demo-user-id-001',
  username: 'demo_guest',
  role: 'demo',
};

// 1. Demo Login (Instant guest access)
router.post('/demo-login', (req, res) => {
  const { accessToken, refreshToken } = generateTokens(DEMO_USER);
  refreshTokensDB.add(refreshToken);

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
  return res.status(200).json({
    message: 'Demo login successful',
    accessToken,
    user: DEMO_USER,
  });
});

// 2. Standard Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find((u) => u.username === username);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { accessToken, refreshToken } = generateTokens(user);
  refreshTokensDB.add(refreshToken);

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
  return res.status(200).json({
    accessToken,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// 3. Rotating Refresh Token Endpoint
router.post('/refresh', (req, res) => {
  const incomingToken = req.cookies.refreshToken;

  if (!incomingToken) {
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  // Token Reuse Detection
  if (!refreshTokensDB.has(incomingToken)) {
    // If the token is valid JWT but not in DB, possible reuse attack occurred
    try {
      const decoded = jwt.verify(incomingToken, process.env.REFRESH_TOKEN_SECRET);
      // In production: invalidate ALL tokens belonging to decoded.id
      console.warn(`Potential token reuse attack by user ${decoded.id}`);
    } catch (_) { }

    res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
    return res.status(403).json({ error: 'Token revoked or already used' });
  }

  // Verify the valid incoming token
  jwt.verify(incomingToken, process.env.REFRESH_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      refreshTokensDB.delete(incomingToken);
      res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    // ROTATION: Delete the old refresh token
    refreshTokensDB.delete(incomingToken);

    // Issue a brand-new token pair
    const targetUser = { id: decoded.id, username: decoded.username, role: decoded.role };
    const tokens = generateTokens(targetUser);

    // Store the new refresh token
    refreshTokensDB.add(tokens.refreshToken);

    // Send new refresh token in HttpOnly cookie and access token in body
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
    return res.status(200).json({ accessToken: tokens.accessToken });
  });
});

// 4. Logout
router.post('/logout', (req, res) => {
  const incomingToken = req.cookies.refreshToken;
  if (incomingToken) {
    refreshTokensDB.delete(incomingToken);
  }
  res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
  return res.status(200).json({ message: 'Logged out successfully' });
});

// 5. Protected Route Test
router.get('/me', verifyAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
