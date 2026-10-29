// The Express app without a listener, so tests can mount it. server.js loads .env, connects the
// databases and listens.
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import { trustProxyHops } from "./config/env.js";
import { pingRedis } from "./config/redis.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import auditRoutes from "./routes/audit.js";
import badgeRequestRoutes from "./routes/badgeRequests.js";
import badgeRoutes from "./routes/badges.js";
import bookingRoutes from "./routes/bookings.js";
import incidentRoutes from "./routes/incidents.js";
import notificationRoutes from "./routes/notifications.js";
import orgUnitRoutes from "./routes/orgUnits.js";
import resourceRoutes from "./routes/resources.js";
import uploadRoutes from "./routes/uploads.js";
import verificationRoutes from "./routes/verification.js";
import { requestIdMiddleware } from "./middleware/requestLogger.js";
import { httpLogger } from "./middleware/httpLogger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

const app = express();

// Render's proxy terminates TLS and forwards the request, and on the site Vercel's rewrite is in front
// of it (architecture.md §11, §18). Trusting those hops (TRUST_PROXY_HOPS: default 1, 2 in render.yaml)
// gives the coarse IP rate limits the addresses they forwarded (req.ips), and makes req.secure reflect
// the original https. A hop count, never true: true would let any client pick its own req.ip with
// X-Forwarded-For.
app.set("trust proxy", trustProxyHops());

// Request ID and HTTP logging come first so parser and route errors carry the ID.
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(helmet());

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
  }),
);

app.use("/api/v1/auth", authRoutes);
// Each router applies its own verifyAuth, limiters and blockSuspended.
app.use("/api/v1/org-units", orgUnitRoutes);
app.use("/api/v1/resources", resourceRoutes);
app.use("/api/v1/badges", badgeRoutes);
app.use("/api/v1/badge-requests", badgeRequestRoutes);
app.use("/api/v1/bookings", bookingRoutes);
app.use("/api/v1/incidents", incidentRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/uploads", uploadRoutes);
app.use("/api/v1/verification", verificationRoutes);
app.use("/api/v1/admin", adminRoutes);

// architecture.md §13.3: 503 only when MongoDB is down. Without Redis the API still serves, with no
// cache and bookings answering 503 (§10.2), so Redis being down is "degraded", not down.
app.get("/health", async (req, res) => {
  const mongo = mongoose.connection.readyState === 1 ? "up" : "down";
  const redis = (await pingRedis()) ? "up" : "degraded";
  res.status(mongo === "up" ? 200 : 503).json({
    status: mongo === "up" ? "ok" : "down",
    mongo,
    redis,
    uptime: Math.round(process.uptime()),
    requestId: req.id,
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
