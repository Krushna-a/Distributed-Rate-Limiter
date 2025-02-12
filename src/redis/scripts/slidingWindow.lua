-- Sliding Window Counter Algorithm (Atomic Redis Implementation)
-- KEYS[1]: Rate limit key (e.g., "ratelimit:sliding:user:123")
-- ARGV[1]: Maximum requests allowed
-- ARGV[2]: Window size (milliseconds)
-- ARGV[3]: Current timestamp (milliseconds)
-- ARGV[4]: Request ID (unique identifier)
-- ARGV[5]: TTL in seconds

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]
local ttl = tonumber(ARGV[5])

-- Calculate window start time
local window_start = now - window_ms

-- Remove entries outside the current window
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

-- Count current requests in window
local current_count = redis.call('ZCARD', key)

-- Check if we can allow this request
local allowed = 0
local remaining = 0

if current_count < limit then
  -- Add this request to the sorted set
  redis.call('ZADD', key, now, request_id)
  allowed = 1
  remaining = limit - current_count - 1
else
  remaining = 0
end

-- Set expiration (window size + buffer)
redis.call('EXPIRE', key, ttl)

-- Calculate retry after (time until oldest request expires)
local retry_after = 0
if allowed == 0 then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] then
    local oldest_timestamp = tonumber(oldest[2])
    retry_after = math.max(0, (oldest_timestamp + window_ms) - now)
  end
end

-- Return: [allowed (0|1), remaining_requests, retry_after_ms]
return {allowed, remaining, retry_after}
