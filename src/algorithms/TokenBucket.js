/**
 * Token Bucket Algorithm Implementation
 *
 * Concept:
 * - Bucket has a maximum capacity of tokens
 * - Tokens are added at a constant rate (refill rate)
 * - Each request consumes tokens
 * - If not enough tokens, request is rejected
 * - Allows bursts up to bucket capacity
 *
 * Use Cases:
 * - General-purpose rate limiting
 * - Allowing burst traffic while limiting average rate
 * - API throttling with flexibility
 */

export class TokenBucket {
  constructor(capacity, refillRate) {
    if (capacity <= 0) {
      throw new Error("Capacity must be positive");
    }
    if (refillRate <= 0) {
      throw new Error("Refill rate must be positive");
    }

    this.capacity = capacity;
    this.refillRate = refillRate; // tokens per second
    this.tokens = capacity; // Start with full bucket
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume tokens from the bucket
   * @param {number} tokens - Number of tokens to consume (default: 1)
   * @returns {boolean} true if request is allowed, false if rate limited
   */
  consume(tokens = 1) {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;

    // Calculate tokens to add
    const tokensToAdd = elapsedSeconds * this.refillRate;

    // Update tokens (capped at capacity)
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get current number of available tokens
   * @returns {number}
   */
  getAvailableTokens() {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Get time in milliseconds until bucket has at least N tokens
   * @param {number} requiredTokens
   * @returns {number}
   */
  getTimeUntilTokensAvailable(requiredTokens) {
    this.refill();

    if (this.tokens >= requiredTokens) {
      return 0;
    }

    const tokensNeeded = requiredTokens - this.tokens;
    const secondsNeeded = tokensNeeded / this.refillRate;
    return Math.ceil(secondsNeeded * 1000);
  }

  /**
   * Reset bucket to full capacity
   */
  reset() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Get current state for serialization
   * @returns {{tokens: number, lastRefill: number}}
   */
  getState() {
    return {
      tokens: this.tokens,
      lastRefill: this.lastRefill,
    };
  }

  /**
   * Restore state from serialized data
   * @param {number} capacity
   * @param {number} refillRate
   * @param {{tokens: number, lastRefill: number}} state
   * @returns {TokenBucket}
   */
  static fromState(capacity, refillRate, state) {
    const bucket = new TokenBucket(capacity, refillRate);
    bucket.tokens = state.tokens;
    bucket.lastRefill = state.lastRefill;
    return bucket;
  }
}
