import { LRUCache } from "lru-cache";
import { randomBytes } from "crypto";
import { logger } from "../monitoring/logger.js";
import {
  requestsTotal,
  requestsAllowed,
  requestsRejected,
  latencyHistogram,
  redisErrors,
} from "../monitoring/metrics.js";

export class RateLimiterMiddleware {
  constructor(redisClient, circuitBreaker, fallbackPolicy) {
    this.redisClient = redisClient;
    this.circuitBreaker = circuitBreaker;
    this.fallbackPolicy = fallbackPolicy;
    this.localCache = null;

    if (fallbackPolicy.mode === "local-cache") {
      this.localCache = new LRUCache({
        max: fallbackPolicy.localCacheMaxSize || 10000,
        ttl: fallbackPolicy.localCacheTTL || 100,
      });
    }
  }

  /**
   * Create Express middleware for rate limiting
   * @param {Object} config - Rate limit configuration
   * @returns {Function} Express middleware function
   */
  middleware(config) {
    return async (req, res, next) => {
      const startTime = Date.now();

      try {
        // Generate rate limit key
        const key = config.keyGenerator
          ? config.keyGenerator(req)
          : this.defaultKeyGenerator(req);

        // Check rate limit
        const result = await this.checkRateLimit(key, config);

        // Record metrics
        const latency = (Date.now() - startTime) / 1000;
        latencyHistogram.observe({ algorithm: config.algorithm }, latency);
        requestsTotal.inc({
          status: result.allowed ? "allowed" : "rejected",
          algorithm: config.algorithm,
        });

        if (result.allowed) {
          requestsAllowed.inc({ algorithm: config.algorithm });

          // Add rate limit headers
          res.setHeader("X-RateLimit-Limit", config.maxRequests.toString());
          res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
          if (result.resetTime) {
            res.setHeader("X-RateLimit-Reset", result.resetTime.toString());
          }

          next();
        } else {
          requestsRejected.inc({ algorithm: config.algorithm });

          // Add retry-after header
          if (result.retryAfter) {
            res.setHeader(
              "Retry-After",
              Math.ceil(result.retryAfter / 1000).toString(),
            );
          }

          if (config.onLimitReached) {
            config.onLimitReached(req);
          }

          res.status(429).json({
            error: "Too Many Requests",
            retryAfter: result.retryAfter,
            limit: config.maxRequests,
          });
        }
      } catch (error) {
        logger.error("Rate limiter error:", error);
        redisErrors.inc({ operation: "check" });

        // Fallback behavior
        if (this.fallbackPolicy.mode === "fail-open") {
          logger.warn("Rate limiter failed, allowing request (fail-open)");
          next();
        } else {
          res.status(503).json({
            error: "Service Temporarily Unavailable",
          });
        }
      }
    };
  }

  /**
   * Check rate limit using configured algorithm
   */
  async checkRateLimit(key, config) {
    // Check local cache first (if enabled)
    if (this.localCache) {
      const cached = this.localCache.get(key);
      if (cached && cached.resetTime > Date.now()) {
        return {
          allowed: cached.allowed,
          remaining: 0,
          retryAfter: cached.resetTime - Date.now(),
        };
      }
    }

    // Execute with circuit breaker protection
    const result = await this.circuitBreaker.execute(async () => {
      if (config.algorithm === "token-bucket") {
        return await this.checkTokenBucket(key, config);
      } else {
        return await this.checkSlidingWindow(key, config);
      }
    });

    // Cache deny decisions briefly to reduce Redis load
    if (!result.allowed && this.localCache) {
      this.localCache.set(key, {
        allowed: false,
        resetTime: Date.now() + (result.retryAfter || 1000),
      });
    }

    return result;
  }

  async checkTokenBucket(key, config) {
    const capacity = config.capacity || config.maxRequests;
    const refillRate = capacity / (config.windowMs / 1000);

    const result = await this.redisClient.executeTokenBucket(
      key,
      capacity,
      refillRate,
      1,
      Math.ceil(config.windowMs / 1000) * 2,
    );

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfter: result.retryAfter,
      resetTime: undefined,
    };
  }

  async checkSlidingWindow(key, config) {
    const requestId = randomBytes(16).toString("hex");

    const result = await this.redisClient.executeSlidingWindow(
      key,
      config.maxRequests,
      config.windowMs,
      requestId,
      Math.ceil(config.windowMs / 1000) * 2,
    );

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfter: result.retryAfter,
      resetTime: result.retryAfter ? Date.now() + result.retryAfter : undefined,
    };
  }

  defaultKeyGenerator(req) {
    // Use IP address as default identifier
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    return `ip:${ip}`;
  }
}
