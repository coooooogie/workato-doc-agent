import { createServer } from "http";

const PORT = parseInt(process.env.HEALTH_PORT ?? "3000", 10);

export function startHealthServer() {
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "workato-doc-agent",
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
  });

  return server;
}
