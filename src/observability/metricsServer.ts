import { createServer, type Server } from "node:http";
import { metricsRegistry } from "./prometheusMetrics.js";
import { logger } from "./logger.js";

/**
 * A plain node:http server, not a framework, deliberately: a single GET /metrics endpoint
 * doesn't need Express/Fastify as a new dependency. Only worth running for a long-lived
 * process (the worker), not the bounded one-shot CLIs -- see cli/worker.ts's METRICS_PORT.
 */
export function startMetricsServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      metricsRegistry
        .metrics()
        .then((body) => {
          res.writeHead(200, { "content-type": metricsRegistry.contentType });
          res.end(body);
        })
        .catch((err: unknown) => {
          logger.error({ err }, "failed to render /metrics");
          res.writeHead(500);
          res.end();
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info({ port }, "metrics server listening on /metrics");
  });

  return server;
}
