import express from "express";
import dotenv from "dotenv";
import { RedisClient } from "./redis/client.js";
import { CircuitBreaker } from "./resilience/CircuitBreaker.js";
import { RateLimiterMiddleware } from "./middleware/rateLimiter.js";
import { getMetricsRegistry } from "./monitoring/metrics.js";
import { logger } from "./monitoring/logger.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Redis client
const redisClient = new RedisClient({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
  keyPrefix: "ratelimit:",
});

// Initialize Circuit Breaker
const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  halfOpenMaxAttempts: 3,
});

// Initialize Rate Limiter Middleware
const rateLimiter = new RateLimiterMiddleware(redisClient, circuitBreaker, {
  mode: "fail-open", // or 'fail-closed' or 'local-cache'
  localCacheTTL: 100,
  localCacheMaxSize: 10000,
});

// Middleware
app.use(express.json());

// Health check endpoint (no rate limit)
app.get("/health", async (req, res) => {
  const redisHealthy = await redisClient.healthCheck();
  const circuitState = circuitBreaker.getState();

  res.json({
    status: redisHealthy ? "healthy" : "degraded",
    redis: redisHealthy,
    circuitBreaker: circuitState,
    timestamp: new Date().toISOString(),
  });
});

// Metrics endpoint (Prometheus)
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", getMetricsRegistry().contentType);
  res.end(await getMetricsRegistry().metrics());
});

// Example: Token Bucket rate limiter
app.use(
  "/api/token-bucket",
  rateLimiter.middleware({
    algorithm: "token-bucket",
    capacity: 10,
    refillRate: 2, // 2 tokens per second
    windowMs: 60000,
    maxRequests: 10,
    keyGenerator: (req) => `user:${req.headers["x-user-id"] || req.ip}`,
  }),
);

app.get("/api/token-bucket/test", (req, res) => {
  res.json({
    message: "Token Bucket: Request allowed!",
    timestamp: Date.now(),
  });
});

// Example: Sliding Window rate limiter
app.use(
  "/api/sliding-window",
  rateLimiter.middleware({
    algorithm: "sliding-window",
    windowMs: 60000, // 1 minute
    maxRequests: 100,
    keyGenerator: (req) => `user:${req.headers["x-user-id"] || req.ip}`,
  }),
);

app.get("/api/sliding-window/test", (req, res) => {
  res.json({
    message: "Sliding Window: Request allowed!",
    timestamp: Date.now(),
  });
});

// General test endpoint with default rate limit
app.get(
  "/api/test",
  rateLimiter.middleware({
    algorithm: "token-bucket",
    capacity: 20,
    refillRate: 5,
    windowMs: 60000,
    maxRequests: 20,
  }),
  (req, res) => {
    res.json({ message: "Request allowed!", timestamp: Date.now() });
  },
);

// Start server
app.listen(PORT, () => {
  logger.info(`Rate Limiter server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Metrics: http://localhost:${PORT}/metrics`);
  logger.info(`Test endpoints:`);
  logger.info(
    `  - Token Bucket: http://localhost:${PORT}/api/token-bucket/test`,
  );
  logger.info(
    `  - Sliding Window: http://localhost:${PORT}/api/sliding-window/test`,
  );
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await redisClient.close();
  process.exit(0);
});
