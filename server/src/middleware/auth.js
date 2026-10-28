import jwt from 'jsonwebtoken';
import { ServiceError } from '../lib/serviceError.js';

// 401 UNAUTHENTICATED is what makes the client refresh the access token once and retry
// (frontend.md §8.1, client/src/lib/http.js), so both failures use that code.
const unauthenticated = (message) => new ServiceError(401, 'UNAUTHENTICATED', message);

export const verifyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return next(unauthenticated('Access token required'));

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return next(unauthenticated('Access token expired or invalid'));
    req.user = decoded;
    next();
  });
};
