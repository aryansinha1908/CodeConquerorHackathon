import 'dotenv/config';

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import { requestIdMiddleware } from './middleware/requestLogger.js';
import { httpLogger } from './middleware/httpLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// Request ID and HTTP logging come first so parser and route errors carry the ID.
app.use(requestIdMiddleware);
app.use(httpLogger);

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  })
);

app.use('/api/v1/auth', authRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', requestId: req.id });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
