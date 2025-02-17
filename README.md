# Distributed Rate Limiter

A production-grade distributed rate limiting middleware built with Node.js, Express, and Redis.

## Demo

<img width="1917" alt="Rate Limiter - Allowed Request" src="https://github.com/user-attachments/assets/b33aca96-84c7-44f8-bdeb-b09d6a0e6df9" />

<img width="1917" alt="Rate Limiter - Rate Limited" src="https://github.com/user-attachments/assets/19a6a11a-9819-4114-8fd6-006de6990e00" />

<img width="728" alt="Docker Container" src="https://github.com/user-attachments/assets/608cb4ad-4aa7-4865-bec4-3decfacb099b" />

<img width="701" alt="Redis Logs" src="https://github.com/user-attachments/assets/6bb8b35c-8f9f-4a28-b715-145ac6c2790e" />

## Overview

This rate limiter protects APIs from abuse by limiting request rates per user/IP. It works across multiple servers using Redis as a centralized state store, ensuring consistency and preventing race conditions under high concurrency.

## Features

- ⚡ **Dual Algorithm Support**: Token Bucket (burst-friendly) & Sliding Window (strict limits)
- 🔒 **Race Condition Prevention**: Atomic Redis Lua scripts
- 🚀 **High Performance**: Sub-5ms latency overhead target
- 🛡️ **Fault Tolerant**: Circuit breaker with configurable fallback modes
- 📊 **Production Ready**: Prometheus metrics and structured logging
- 🔌 **Flexible**: Easy integration as Express middleware

## Architecture

```
Client Request → Express Middleware → Redis (Lua Scripts) → Allow/Deny
                                   ↓ (on failure)
                            Circuit Breaker → Local Fallback
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design.

## Quick Start

### Prerequisites
- Node.js v18+
- Docker (for Redis)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd Rate-Limiter

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Start Redis
docker compose up -d redis

# Start the server
npm run dev
```

Server runs at: `http://localhost:3001`

## Usage

### Test Endpoints

```bash
# Token Bucket algorithm (allows bursts)
curl http://localhost:3001/api/token-bucket/test

# Sliding Window algorithm (strict limits)
curl http://localhost:3001/api/sliding-window/test

# Health check
curl http://localhost:3001/health

# Prometheus metrics
curl http://localhost:3001/metrics
```

### Verify Rate Limiting

```bash
# Send multiple requests rapidly
for i in {1..15}; do curl http://localhost:3001/api/token-bucket/test; done

# Expected: First 10 succeed (200), rest get rate limited (429)
```

### Integration Example

```javascript
import { RateLimiterMiddleware } from './middleware/rateLimiter.js';

// Apply to specific routes
app.use('/api/protected', rateLimiter.middleware({
  algorithm: 'token-bucket',
  capacity: 100,
  refillRate: 10,
  keyGenerator: (req) => req.user.id
}));
```

## Configuration

Edit `.env` file:

```env
PORT=3001
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
FALLBACK_MODE=fail-open  # Options: fail-open | fail-closed | local-cache
LOG_LEVEL=info
```

## Algorithms

### Token Bucket
- Tokens refill at constant rate
- Allows controlled bursts up to capacity
- Ideal for: APIs with occasional traffic spikes

**Configuration:**
- `capacity`: Maximum tokens (burst size)
- `refillRate`: Tokens added per second

### Sliding Window Counter
- Tracks exact request timestamps using Redis sorted sets
- Enforces strict per-window limits
- Ideal for: Precise quota enforcement (e.g., "100 req/min")

**Configuration:**
- `maxRequests`: Maximum requests per window
- `windowMs`: Time window in milliseconds

## Testing

```bash
# Run unit tests
npm test

# Load testing with k6 (install k6 first)
k6 run benchmarks/k6/steady-load.js
k6 run benchmarks/k6/concurrent-burst.js
```

## Project Structure

```
src/
├── algorithms/          # Local fallback implementations
├── middleware/          # Express middleware
├── redis/              
│   ├── client.js       # Redis connection & script loading
│   └── scripts/        # Lua scripts for atomic operations
├── resilience/         # Circuit breaker pattern
├── monitoring/         # Logging & metrics
└── server.js           # Express app

tests/                  # Jest unit tests
benchmarks/k6/          # Load testing scripts
```

## Fault Tolerance

The circuit breaker monitors Redis health and switches modes on failure:

- **Closed**: Normal operation (Redis working)
- **Open**: Redis failed, use fallback strategy
- **Half-Open**: Testing recovery

**Fallback Modes:**
- `fail-open`: Allow all requests (permissive)
- `fail-closed`: Deny all requests (secure)
- `local-cache`: Per-server limits using in-memory store

## Performance

- **Throughput**: 10,000+ requests/second per instance
- **Latency**: P99 < 5ms overhead
- **Atomicity**: Zero race conditions via Lua scripts
- **Recovery**: Circuit opens in < 100ms on Redis failure

## Monitoring

Prometheus metrics exposed at `/metrics`:

- `rate_limiter_requests_total{status="allowed|rejected"}`
- `rate_limiter_latency_seconds`
- `rate_limiter_redis_errors_total`
- `rate_limiter_circuit_breaker_state`

Winston structured logs for debugging and audit trails.

## Scaling

- **Horizontal**: Stateless design, add servers behind load balancer
- **Redis**: Use Redis Cluster for distributed state (16,384 hash slots)
- **Optimization**: Connection pooling, optional local cache layer

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **State Store**: Redis with ioredis client
- **Testing**: Jest + k6
- **Observability**: Winston (logs) + Prometheus (metrics)

## How It Works

### Preventing Race Conditions

Multiple servers checking limits simultaneously could cause over-limit:

```
Server A reads: 99 requests → allows request
Server B reads: 99 requests → allows request
Result: 101 requests (limit was 100)
```

**Solution**: Redis Lua scripts execute atomically, preventing interleaving.

```lua
-- Atomic check-and-increment in Lua
local count = redis.call('GET', key)
if count < limit then
  redis.call('INCR', key)
  return {allowed=1, remaining=limit-count-1}
else
  return {allowed=0, remaining=0}
end
```

## Contributing

Contributions welcome! Please open issues for bugs or feature requests.

## License

MIT License

## Further Reading

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed system design
- [Redis Lua Scripting](https://redis.io/commands/eval)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Rate Limiting Algorithms](https://en.wikipedia.org/wiki/Rate_limiting)
