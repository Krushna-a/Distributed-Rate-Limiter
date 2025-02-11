import { Counter, Histogram, Gauge, register } from "prom-client";

// Request counters
export const requestsTotal = new Counter({
  name: "rate_limiter_requests_total",
  help: "Total number of rate limit checks",
  labelNames: ["status", "algorithm"],
});

export const requestsAllowed = new Counter({
  name: "rate_limiter_requests_allowed_total",
  help: "Total number of allowed requests",
  labelNames: ["algorithm"],
});

export const requestsRejected = new Counter({
  name: "rate_limiter_requests_rejected_total",
  help: "Total number of rejected requests",
  labelNames: ["algorithm"],
});

// Latency histogram
export const latencyHistogram = new Histogram({
  name: "rate_limiter_latency_seconds",
  help: "Rate limiter check latency",
  labelNames: ["algorithm"],
  buckets: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1],
});

// Redis operations
export const redisErrors = new Counter({
  name: "rate_limiter_redis_errors_total",
  help: "Total number of Redis errors",
  labelNames: ["operation"],
});

export const redisLatency = new Histogram({
  name: "rate_limiter_redis_latency_seconds",
  help: "Redis operation latency",
  labelNames: ["operation"],
  buckets: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05],
});

// Circuit breaker
export const circuitBreakerState = new Gauge({
  name: "rate_limiter_circuit_breaker_state",
  help: "Circuit breaker state (0=closed, 1=half-open, 2=open)",
});

export const circuitBreakerTrips = new Counter({
  name: "rate_limiter_circuit_breaker_trips_total",
  help: "Total number of circuit breaker trips",
});

// Cache metrics
export const cacheHits = new Counter({
  name: "rate_limiter_cache_hits_total",
  help: "Total number of local cache hits",
});

export const cacheMisses = new Counter({
  name: "rate_limiter_cache_misses_total",
  help: "Total number of local cache misses",
});

export function getMetricsRegistry() {
  return register;
}
