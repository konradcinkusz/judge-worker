import { describe, expect, it, afterEach } from "vitest";
import type { Server } from "node:http";
import { startMetricsServer } from "../src/observability/metricsServer.js";
import { metricsRegistry, recordDeadLetter } from "../src/observability/prometheusMetrics.js";

/** Real HTTP requests against a real server bound to an OS-assigned port (port 0), not a
 *  mocked request/response pair -- proves the actual listener, routing, and content-type. */

let server: Server | undefined;

function baseUrl(s: Server): string {
  const address = s.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

describe("observability/metricsServer.ts startMetricsServer", () => {
  it("serves Prometheus exposition format on GET /metrics", async () => {
    metricsRegistry.resetMetrics();
    recordDeadLetter();
    server = startMetricsServer(0);

    const response = await fetch(`${baseUrl(server)}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("judge_worker_jobs_dead_lettered_total 1");
    // Default process metrics (collectDefaultMetrics) should be present too.
    expect(body).toContain("process_cpu_user_seconds_total");
  });

  it("returns 404 for any other path", async () => {
    server = startMetricsServer(0);
    const response = await fetch(`${baseUrl(server)}/not-metrics`);
    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-GET request to /metrics", async () => {
    server = startMetricsServer(0);
    const response = await fetch(`${baseUrl(server)}/metrics`, { method: "POST" });
    expect(response.status).toBe(404);
  });
});
