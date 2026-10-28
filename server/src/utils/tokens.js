import jwt from 'jsonwebtoken';

export const generateTokens = (user) => {
  const payload = { id: user.id, username: user.username, role: user.role };

  const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: '15m',
  });

  const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: '7d',
  });

  return { accessToken, refreshToken };
};

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', // Use 'none' if client and server are on different root domains with HTTPS
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};
