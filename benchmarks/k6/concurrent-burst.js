import http from "k6/http";
import { check } from "k6";
import { Rate, Counter } from "k6/metrics";

// Metrics to verify no race conditions
const allowedCounter = new Counter("total_allowed");
const rejectedCounter = new Counter("total_rejected");
const raceConditionRate = new Rate("potential_race_conditions");

export const options = {
  scenarios: {
    // Scenario 1: Multiple users hitting limit simultaneously
    concurrent_burst: {
      executor: "constant-vus",
      vus: 100,
      duration: "10s",
      gracefulStop: "5s",
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<10"],
    potential_race_conditions: ["rate<0.001"], // Less than 0.1% race conditions
  },
};

const USER_ID = "test-user-concurrent";
const EXPECTED_LIMIT = 20; // Based on server config

export default function () {
  const response = http.get("http://localhost:3000/api/test", {
    headers: { "X-User-ID": USER_ID },
  });

  if (response.status === 200) {
    allowedCounter.add(1);
  } else if (response.status === 429) {
    rejectedCounter.add(1);
  }

  check(response, {
    "valid response": (r) => r.status === 200 || r.status === 429,
  });
}

export function handleSummary(data) {
  const totalAllowed = data.metrics.total_allowed?.values?.count || 0;
  const totalRejected = data.metrics.total_rejected?.values?.count || 0;
  const totalRequests = totalAllowed + totalRejected;

  console.log("\n=== CONCURRENCY TEST RESULTS ===");
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Allowed: ${totalAllowed}`);
  console.log(`Rejected: ${totalRejected}`);
  console.log(`Expected Max Allowed: ~${EXPECTED_LIMIT} (per refill window)`);

  // Verify no significant over-counting (race conditions)
  const overageThreshold = EXPECTED_LIMIT * 1.1; // 10% tolerance
  const hasRaceConditions = totalAllowed > overageThreshold;

  console.log(
    `Race Conditions Detected: ${hasRaceConditions ? "YES ⚠️" : "NO ✓"}`,
  );

  return {
    "results/concurrent-burst-summary.json": JSON.stringify(
      {
        ...data,
        analysis: {
          totalRequests,
          totalAllowed,
          totalRejected,
          expectedLimit: EXPECTED_LIMIT,
          raceConditionsDetected: hasRaceConditions,
        },
      },
      null,
      2,
    ),
  };
}
