import { logger } from '../monitoring/logger.js';

/**
 * Circuit Breaker States
 */
export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures when Redis is unavailable
 * 
 * States:
 * - CLOSED: Normal operation, requests go to Redis
 * - OPEN: Redis failed, immediately use fallback
 * - HALF_OPEN: Testing if Redis recovered
 */
export class CircuitBreaker {
  constructor(config) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 60000, // 1 minute
      halfOpenMaxAttempts: config.halfOpenMaxAttempts || 3,
    };

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = 0;
  }

  /**
   * Execute function with circuit breaker protection
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async execute(fn) {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      // Transition to HALF_OPEN
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
      logger.info('Circuit breaker transitioning to HALF_OPEN');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        logger.info('Circuit breaker CLOSED (recovered)');
      }
    }
  }

  onFailure() {
    this.failureCount++;
    this.successCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.tripCircuit();
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.tripCircuit();
    }
  }

  tripCircuit() {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.config.timeout;
    logger.warn(`Circuit breaker OPEN (failures: ${this.failureCount})`);
  }

  getState() {
    return this.state;
  }

  isOpen() {
    return this.state === CircuitState.OPEN;
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    logger.info('Circuit breaker manually reset');
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptIn: Math.max(0, this.nextAttempt - Date.now()),
    };
  }
}
