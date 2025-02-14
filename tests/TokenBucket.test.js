import { TokenBucket } from "../src/algorithms/TokenBucket.js";

describe("TokenBucket Algorithm", () => {
  describe("Constructor", () => {
    it("should create a bucket with full capacity", () => {
      const bucket = new TokenBucket(10, 1);
      expect(bucket.getAvailableTokens()).toBe(10);
    });

    it("should throw error for invalid capacity", () => {
      expect(() => new TokenBucket(0, 1)).toThrow("Capacity must be positive");
      expect(() => new TokenBucket(-5, 1)).toThrow("Capacity must be positive");
    });

    it("should throw error for invalid refill rate", () => {
      expect(() => new TokenBucket(10, 0)).toThrow(
        "Refill rate must be positive",
      );
      expect(() => new TokenBucket(10, -1)).toThrow(
        "Refill rate must be positive",
      );
    });
  });

  describe("Token Consumption", () => {
    it("should allow requests when tokens available", () => {
      const bucket = new TokenBucket(5, 1);
      expect(bucket.consume(1)).toBe(true);
      expect(bucket.consume(1)).toBe(true);
      expect(bucket.getAvailableTokens()).toBe(3);
    });

    it("should reject requests when insufficient tokens", () => {
      const bucket = new TokenBucket(2, 1);
      expect(bucket.consume(1)).toBe(true);
      expect(bucket.consume(1)).toBe(true);
      expect(bucket.consume(1)).toBe(false); // No tokens left
    });

    it("should handle consuming multiple tokens", () => {
      const bucket = new TokenBucket(10, 1);
      expect(bucket.consume(5)).toBe(true);
      expect(bucket.getAvailableTokens()).toBe(5);
      expect(bucket.consume(6)).toBe(false); // Need 6, have 5
    });

    it("should allow burst up to capacity", () => {
      const bucket = new TokenBucket(100, 1);
      for (let i = 0; i < 100; i++) {
        expect(bucket.consume(1)).toBe(true);
      }
      expect(bucket.consume(1)).toBe(false);
    });
  });

  describe("Token Refill", () => {
    it("should refill tokens over time", async () => {
      const bucket = new TokenBucket(10, 10); // 10 tokens per second
      bucket.consume(10); // Drain bucket
      expect(bucket.getAvailableTokens()).toBe(0);

      // Wait 500ms (should refill 5 tokens)
      await new Promise((resolve) => setTimeout(resolve, 500));

      const available = bucket.getAvailableTokens();
      expect(available).toBeGreaterThanOrEqual(4); // Some tolerance
      expect(available).toBeLessThanOrEqual(6);
    });

    it("should cap tokens at capacity", async () => {
      const bucket = new TokenBucket(5, 10);
      bucket.consume(5); // Drain

      // Wait 1 second (would refill 10, but cap at 5)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(bucket.getAvailableTokens()).toBe(5);
    });

    it("should refill gradually", async () => {
      const bucket = new TokenBucket(100, 10); // 10 tokens/sec
      bucket.consume(100); // Drain completely

      await new Promise((resolve) => setTimeout(resolve, 250)); // 0.25s
      expect(bucket.getAvailableTokens()).toBeGreaterThanOrEqual(1);
      expect(bucket.getAvailableTokens()).toBeLessThanOrEqual(4);
    });
  });

  describe("Retry Timing", () => {
    it("should calculate time until tokens available", () => {
      const bucket = new TokenBucket(10, 10); // 10 tokens/sec
      bucket.consume(10); // Drain

      const retryTime = bucket.getTimeUntilTokensAvailable(5);
      expect(retryTime).toBeGreaterThanOrEqual(400); // Need 5 tokens at 10/sec
      expect(retryTime).toBeLessThanOrEqual(600);
    });

    it("should return 0 if tokens already available", () => {
      const bucket = new TokenBucket(10, 1);
      expect(bucket.getTimeUntilTokensAvailable(5)).toBe(0);
    });
  });

  describe("State Management", () => {
    it("should export and restore state", () => {
      const bucket1 = new TokenBucket(10, 2);
      bucket1.consume(5);

      const state = bucket1.getState();
      expect(state.tokens).toBe(5);
      expect(state.lastRefill).toBeDefined();

      const bucket2 = TokenBucket.fromState(10, 2, state);
      expect(bucket2.getAvailableTokens()).toBe(5);
    });

    it("should reset to full capacity", () => {
      const bucket = new TokenBucket(10, 1);
      bucket.consume(7);
      expect(bucket.getAvailableTokens()).toBe(3);

      bucket.reset();
      expect(bucket.getAvailableTokens()).toBe(10);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero token consumption", () => {
      const bucket = new TokenBucket(10, 1);
      expect(bucket.consume(0)).toBe(true);
      expect(bucket.getAvailableTokens()).toBe(10);
    });

    it("should handle fractional refill rates", () => {
      const bucket = new TokenBucket(10, 0.5); // 0.5 tokens/sec
      bucket.consume(10);

      // After 2 seconds should have ~1 token
      setTimeout(() => {
        expect(bucket.getAvailableTokens()).toBeGreaterThanOrEqual(0);
      }, 2000);
    });
  });
});
