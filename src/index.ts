import "dotenv/config";
import { startScheduler } from "./scheduler.js";
import { startHealthServer } from "./health.js";
import { runDocumentationPipeline } from "./pipeline/orchestrator.js";
import { logger } from "./logger.js";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "sync") {
    const customerId = args[1];
    const forceRegenerate = args.includes("--force");
    await runDocumentationPipeline(
      customerId || undefined,
      forceRegenerate
    );
    // Flush pino logs before exiting
    logger.flush();
    process.exit(0);
  }

  const server = startHealthServer();
  startScheduler();

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Received shutdown signal, cleaning up...");
    server.close(() => {
      logger.info("Health server closed");
      logger.flush();
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown stalls
    setTimeout(() => {
      logger.warn("Forceful shutdown after timeout");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
