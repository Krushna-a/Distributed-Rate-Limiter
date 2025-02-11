import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../monitoring/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RedisClient {
  constructor(config) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db || 0,
      keyPrefix: config.keyPrefix || 'ratelimit:',
      connectTimeout: config.connectTimeout || 5000,
      maxRetriesPerRequest: config.maxRetriesPerRequest || 1,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: false,
      enableReadyCheck: true,
      enableOfflineQueue: false,
    });

    // Load Lua scripts
    this.tokenBucketScript = readFileSync(join(__dirname, 'scripts', 'tokenBucket.lua'), 'utf-8');
    this.slidingWindowScript = readFileSync(
      join(__dirname, 'scripts', 'slidingWindow.lua'),
      'utf-8'
    );

    this.tokenBucketSha = null;
    this.slidingWindowSha = null;

    // Event handlers
    this.client.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    this.client.on('connect', () => {
      logger.info('Redis connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis ready');
      this.loadScripts();
    });
  }

  /**
   * Load Lua scripts into Redis and cache their SHA hashes
   */
  async loadScripts() {
    try {
      this.tokenBucketSha = await this.client.script('LOAD', this.tokenBucketScript);
      this.slidingWindowSha = await this.client.script('LOAD', this.slidingWindowScript);
      logger.info('Lua scripts loaded successfully');
    } catch (error) {
      logger.error('Failed to load Lua scripts:', error);
    }
  }

  /**
   * Execute token bucket algorithm atomically
   * @param {string} key
   * @param {number} capacity
   * @param {number} refillRate
   * @param {number} requested
   * @param {number} ttl
   * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number}>}
   */
  async executeTokenBucket(key, capacity, refillRate, requested = 1, ttl = 3600) {
    const now = Date.now();

    try {
      let result;

      if (this.tokenBucketSha) {
        // Use EVALSHA (faster, script already loaded)
        result = await this.client.evalsha(
          this.tokenBucketSha,
          1,
          key,
          capacity,
          refillRate,
          now,
          requested,
          ttl
        );
      } else {
        // Fallback to EVAL
        result = await this.client.eval(
          this.tokenBucketScript,
          1,
          key,
          capacity,
          refillRate,
          now,
          requested,
          ttl
        );
      }

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        retryAfter: result[2],
      };
    } catch (error) {
      logger.error('Token bucket execution error:', error);
      throw error;
    }
  }

  /**
   * Execute sliding window algorithm atomically
   * @param {string} key
   * @param {number} limit
   * @param {number} windowMs
   * @param {string} requestId
   * @param {number} ttl
   * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number}>}
   */
  async executeSlidingWindow(key, limit, windowMs, requestId, ttl = 3600) {
    const now = Date.now();

    try {
      let result;

      if (this.slidingWindowSha) {
        result = await this.client.evalsha(
          this.slidingWindowSha,
          1,
          key,
          limit,
          windowMs,
          now,
          requestId,
          ttl
        );
      } else {
        result = await this.client.eval(
          this.slidingWindowScript,
          1,
          key,
          limit,
          windowMs,
          now,
          requestId,
          ttl
        );
      }

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        retryAfter: result[2],
      };
    } catch (error) {
      logger.error('Sliding window execution error:', error);
      throw error;
    }
  }

  /**
   * Check if Redis is healthy
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Redis info for monitoring
   * @returns {Promise<string>}
   */
  async getInfo() {
    return await this.client.info();
  }

  /**
   * Close Redis connection
   * @returns {Promise<void>}
   */
  async close() {
    await this.client.quit();
  }

  /**
   * Get the underlying ioredis client
   * @returns {Redis}
   */
  getClient() {
    return this.client;
  }
}
