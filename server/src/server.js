import 'dotenv/config';

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import { connectDb, disconnectDb } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { startSweeper, stopSweeper } from './jobs/sweeper.js';

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);

// Every API route lives under /api/v1 (architecture.md §6); the client's axios baseURL is '/api/v1'.
app.use('/api/v1/auth', authRoutes);

const PORT = process.env.PORT || 5000;

// MongoDB is required. Redis isn't: without it the API still starts, with no cache, and bookings
// answer 503 until it reconnects. The sweeper starts after MongoDB, because it queries bookings.
async function start() {
  await connectDb();
  await connectRedis();
  startSweeper();
  const server = app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

  // Render sends SIGTERM on every deploy and restart; Ctrl+C sends SIGINT.
  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await stopSweeper();
    await Promise.allSettled([disconnectRedis(), disconnectDb()]);
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

start().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
