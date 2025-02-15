import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const rateLimitedRate = new Rate("rate_limited");
const allowedRate = new Rate("allowed");
const latencyTrend = new Trend("rate_limiter_latency");

export const options = {
  stages: [
    { duration: "30s", target: 50 }, // Ramp up to 50 users
    { duration: "1m", target: 100 }, // Stay at 100 users
    { duration: "30s", target: 200 }, // Spike to 200 users
    { duration: "1m", target: 100 }, // Back to 100 users
    { duration: "30s", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<5"], // 95% of requests under 5ms
    http_req_failed: ["rate<0.01"], // Less than 1% errors (excluding 429)
    rate_limiter_latency: ["p(99)<10"], // 99% under 10ms
  },
};

export default function () {
  const userId = Math.floor(Math.random() * 100); // 100 different users

  const startTime = Date.now();
  const response = http.get("http://localhost:3000/api/test", {
    headers: { "X-User-ID": `user-${userId}` },
  });
  const latency = Date.now() - startTime;

  latencyTrend.add(latency);

  if (response.status === 200) {
    allowedRate.add(1);
    check(response, {
      "status is 200": (r) => r.status === 200,
      "has rate limit headers": (r) =>
        r.headers["X-Ratelimit-Limit"] !== undefined,
    });
  } else if (response.status === 429) {
    rateLimitedRate.add(1);
    check(response, {
      "status is 429": (r) => r.status === 429,
      "has retry-after header": (r) => r.headers["Retry-After"] !== undefined,
    });
  } else {
    check(response, {
      "unexpected status": () => false,
    });
  }

  sleep(0.1); // Small delay between requests
}

export function handleSummary(data) {
  return {
    "results/steady-load-summary.json": JSON.stringify(data, null, 2),
  };
}
