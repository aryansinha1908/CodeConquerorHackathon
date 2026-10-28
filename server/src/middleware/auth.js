import jwt from 'jsonwebtoken';

export const verifyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Access token expired or invalid' });
    }
    req.user = decoded;
    next();
  });
};
