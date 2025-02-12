-- Token Bucket Algorithm (Atomic Redis Implementation)
-- KEYS[1]: Rate limit key (e.g., "ratelimit:token:user:123")
-- ARGV[1]: Capacity (maximum tokens)
-- ARGV[2]: Refill rate (tokens per second)
-- ARGV[3]: Current timestamp (milliseconds)
-- ARGV[4]: Tokens requested (default: 1)
-- ARGV[5]: TTL in seconds

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4]) or 1
local ttl = tonumber(ARGV[5])

-- Get current bucket state
local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

-- Initialize if bucket doesn't exist
if not tokens then
  tokens = capacity
  last_refill = now
end

-- Calculate tokens to refill
local elapsed_seconds = (now - last_refill) / 1000.0
local tokens_to_add = elapsed_seconds * refill_rate

-- Refill tokens (capped at capacity)
tokens = math.min(capacity, tokens + tokens_to_add)

-- Update last refill time
last_refill = now

-- Try to consume tokens
local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

-- Save updated state
redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(last_refill))
redis.call('EXPIRE', key, ttl)

-- Calculate retry after (milliseconds until requested tokens available)
local retry_after = 0
if allowed == 0 then
  local tokens_needed = requested - tokens
  retry_after = math.ceil((tokens_needed / refill_rate) * 1000)
end

-- Return: [allowed (0|1), remaining_tokens, retry_after_ms]
return {allowed, math.floor(tokens), retry_after}
