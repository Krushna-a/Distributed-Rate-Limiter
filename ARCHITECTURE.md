# System Architecture

## Overview

This document describes the design and implementation of a distributed rate limiting system built for high concurrency, fault tolerance, and low latency.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Load Balancer                            │
└──────────────┬──────────────┬──────────────┬────────────────┘
               │              │              │
       ┌───────▼──────┐ ┌────▼──────┐ ┌────▼──────┐
       │ API Server 1 │ │API Server 2│ │API Server N│
       │   + Rate     │ │  + Rate    │ │  + Rate   │
       │  Limiter MW  │ │ Limiter MW │ │ Limiter MW│
       └───────┬──────┘ └────┬──────┘ └────┬──────┘
               │              │              │
               └──────────────┼──────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Redis Cluster    │
                    │  (Centralized     │
                    │   State Store)    │
                    └───────────────────┘
```

## Request Flow

1. Client sends request to API server
2. Rate limiter middleware intercepts request
3. Atomic check in Redis via Lua script
4. Decision:
   - **Allow**: Pass to handler, return 200
   - **Deny**: Return 429 with Retry-After header
5. **Fallback**: If Redis unavailable, use circuit breaker strategy

## Algorithm Implementations

### 1. Token Bucket

**Best for**: APIs with bursty traffic patterns

**Data Structure** (Redis Hash):
```
Key: ratelimit:token:{identifier}
Fields:
  - tokens: current token count
  - last_refill: last refill timestamp (ms)
TTL: Auto-expires after inactivity
```

**Algorithm**:
1. Calculate elapsed time since last refill
2. Add refilled tokens: `elapsed * refillRate`
3. Cap at bucket capacity
4. If tokens >= requested: allow and decrement
5. Else: deny with retry-after calculation

**Example Configuration**:
```javascript
{
  capacity: 100,        // Max burst size
  refillRate: 10,       // Tokens per second
  requested: 1          // Tokens per request
}
```

### 2. Sliding Window Counter

**Best for**: Strict time-based quotas

**Data Structure** (Redis Sorted Set):
```
Key: ratelimit:sliding:{identifier}:{window}
Members: request_id (unique per request)
Score: timestamp_ms
TTL: window duration
```

**Algorithm**:
1. Calculate window start: `now - windowMs`
2. Remove expired entries: `ZREMRANGEBYSCORE key -inf window_start`
3. Count current requests: `ZCARD key`
4. If count < limit: add new entry with `ZADD`
5. Else: deny with retry calculation

**Example Configuration**:
```javascript
{
  maxRequests: 100,     // Requests per window
  windowMs: 60000       // 1 minute window
}
```

## Preventing Race Conditions

### The Problem

Without atomicity, concurrent checks from multiple servers cause over-limit:

```
Time T+0ms:  Server A reads count=99  ✓ (under limit)
Time T+0ms:  Server B reads count=99  ✓ (under limit)
Time T+1ms:  Server A increments → 100
Time T+1ms:  Server B increments → 101 ❌ (exceeded limit!)
```

### The Solution: Lua Scripts

Redis executes Lua scripts atomically, preventing interleaving:

```lua
-- Token Bucket (Simplified)
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or capacity
local last_refill = tonumber(data[2]) or now

-- Calculate refill
local elapsed = (now - last_refill) / 1000
local new_tokens = math.min(capacity, tokens + (elapsed * refill_rate))

-- Check if request allowed
if new_tokens >= 1 then
  redis.call('HMSET', key, 'tokens', new_tokens - 1, 'last_refill', now)
  redis.call('EXPIRE', key, 3600)
  return {1, math.floor(new_tokens - 1)}  -- allowed
else
  return {0, 0}  -- denied
end
```

**Why Lua?**
- Single-threaded execution in Redis
- All operations bundled in one network call
- No race conditions possible
- Consistent results across distributed servers

## Fault Tolerance

### Circuit Breaker Pattern

Protects system when Redis becomes unavailable.

**States**:
```
┌─────────┐ failure threshold exceeded  ┌──────┐
│ CLOSED  │───────────────────────────→ │ OPEN │
└────┬────┘                             └───┬──┘
     │  ↑                                   │
     │  │ success threshold met            │ timeout elapsed
     │  │                                   │
     │  └─────────────┐      ┌──────────────┘
     │                │      │
     │           ┌────▼──────▼─┐
     └───────────│ HALF-OPEN   │
                 └─────────────┘
```

**Configuration**:
- `failureThreshold`: Failures before opening (default: 5)
- `timeout`: Time before trying half-open (default: 60s)
- `successThreshold`: Successes to close circuit (default: 2)

### Fallback Strategies

**1. Fail-Open** (Permissive):
- Allow all requests when Redis down
- Pros: Service continues
- Cons: No rate limiting temporarily

**2. Fail-Closed** (Secure):
- Deny all requests when Redis down
- Pros: Security maintained
- Cons: Service unavailable

**3. Local Cache** (Hybrid):
- Use per-server in-memory limits
- Pros: Partial protection
- Cons: Limits not globally enforced

## Performance Optimization

### Target Metrics
- **Latency**: < 5ms P99 overhead
- **Throughput**: 10,000+ req/sec per instance
- **Availability**: 99.9%+ with circuit breaker

### Optimization Techniques

**1. Connection Pooling**
- Reuse Redis connections
- Configurable pool size
- Reduces connection overhead

**2. Lua Scripts**
- Single round-trip instead of multiple commands
- Network latency: 1 RTT vs 3-5 RTTs
- Atomic execution bonus

**3. Efficient Data Structures**
- Hashes for token bucket (O(1) operations)
- Sorted sets for sliding window (O(log N) operations)
- Auto-expiring keys (memory efficient)

**4. Async Operations**
- Non-blocking logging
- Metrics collection in background
- Don't block request path

### Latency Budget

```
Network RTT to Redis:    1-2ms
Lua script execution:    0.2-0.5ms
Middleware overhead:     0.3-0.5ms
Serialization:           0.1-0.3ms
──────────────────────────────────
Total target:            < 5ms
```

## Data Models

### Token Bucket Keys

```
Key Pattern: ratelimit:token:{identifier}
Example: ratelimit:token:user:12345

Hash Fields:
  tokens      → 87.5 (float)
  last_refill → 1724850200000 (timestamp)

TTL: 3600s (auto-cleanup)
```

### Sliding Window Keys

```
Key Pattern: ratelimit:sliding:{identifier}:{window}
Example: ratelimit:sliding:user:12345:60000

Sorted Set:
  Score                    Member
  1724850200123 →  req_abc123
  1724850201456 →  req_def456
  1724850202789 →  req_ghi789

TTL: {windowMs} + buffer
```

### Circuit Breaker State

```
In-memory only (not persisted to Redis):
  state: "closed" | "open" | "half-open"
  failures: 0
  successes: 0
  lastFailureTime: null
  nextAttemptTime: null
```

## Scalability

### Horizontal Scaling

**Stateless Design**:
- Middleware has no local state (except fallback cache)
- Any server can handle any request
- Scale by adding more API servers

**Redis Cluster**:
- Distribute keys across nodes via hash slots
- 16,384 slots total
- Keys automatically sharded: `CRC16(key) mod 16384`

### Vertical Scaling

**Redis Optimization**:
- Use Redis with persistence (RDB + AOF)
- Monitor memory usage, set `maxmemory` policy
- Use connection pooling (max connections per server)

**API Server**:
- Node.js cluster mode (multi-core)
- Increase connection pool size
- Tune keep-alive settings

## Monitoring & Observability

### Key Metrics

**Request Metrics**:
- `rate_limiter_requests_total{status="allowed|rejected"}`
- `rate_limiter_latency_seconds{quantile="0.5|0.95|0.99"}`

**Redis Metrics**:
- `rate_limiter_redis_errors_total`
- `rate_limiter_redis_latency_seconds`

**Circuit Breaker**:
- `rate_limiter_circuit_breaker_state` (gauge: 0=closed, 1=open, 2=half-open)
- `rate_limiter_circuit_breaker_transitions_total`

### Structured Logging

Winston logs with context:
```json
{
  "level": "info",
  "message": "Request allowed",
  "service": "rate-limiter",
  "identifier": "user:12345",
  "algorithm": "token-bucket",
  "remaining": 87,
  "timestamp": "2024-08-28T13:23:20.170Z"
}
```

## Security Considerations

**1. Identifier Selection**:
- User ID: Requires authentication
- IP Address: Can be spoofed, use X-Forwarded-For carefully
- API Key: Best for public APIs

**2. Redis Security**:
- Enable AUTH password
- Use TLS encryption
- Network isolation (private subnet)

**3. DDoS Protection**:
- Rate limiter is one layer
- Combine with: CDN/WAF, network firewall, auto-scaling

**4. Key Enumeration**:
- Use hashed identifiers if sensitive
- Don't expose internal user IDs

## Trade-offs & Design Decisions

| Aspect | Choice | Alternative | Rationale |
|--------|--------|-------------|-----------|
| **State Store** | Redis | In-memory per-server | Need distributed consistency |
| **Atomicity** | Lua scripts | Multi-command transactions | Simpler, fewer round-trips |
| **Algorithms** | Token Bucket + Sliding Window | Leaky Bucket, Fixed Window | Cover common use cases |
| **Fallback** | Configurable modes | Always fail-closed | Flexibility for different SLAs |
| **Language** | Node.js | Go, Rust | Async I/O, ecosystem fit |

## Future Enhancements

- Redis Sentinel for high availability
- Dynamic rate limits (per user tier)
- Multi-dimensional limits (per endpoint + per user)
- Distributed tracing integration (OpenTelemetry)
- WebSocket rate limiting support
- Rate limit warming (gradual limit increases)

## References

- [Redis Lua Scripting](https://redis.io/commands/eval)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Rate Limiting Strategies](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)
