import { createServer, Server } from "http";
import { logger } from "./logger.js";

const PORT = parseInt(process.env.HEALTH_PORT ?? "3000", 10);

export function startHealthServer(): Server {
  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0]; // strip query params
    if (url === "/health" || url === "/") {
      const checks: Record<string, string> = {};
      let healthy = true;

      // Check required env vars
      if (!process.env.WORKATO_API_TOKEN) {
        checks.workato_token = "missing";
        healthy = false;
      } else {
        checks.workato_token = "ok";
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        checks.anthropic_key = "missing";
        healthy = false;
      } else {
        checks.anthropic_key = "ok";
      }

      const status = healthy ? "ok" : "degraded";
      const statusCode = healthy ? 200 : 503;

      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status,
          service: "workato-doc-agent",
          checks,
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(PORT, () => {
    logger.info({ port: PORT }, "Health server listening");
  });

  return server;
}
