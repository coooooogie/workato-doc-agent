import "dotenv/config";
import { startScheduler } from "./scheduler.js";
import { startHealthServer } from "./health.js";
import { runDocumentationPipeline } from "./pipeline/orchestrator.js";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "sync") {
    const customerId = args[1];
    const forceRegenerate = args.includes("--force");
    await runDocumentationPipeline(
      customerId || undefined,
      forceRegenerate
    );
    process.exit(0);
  }

  startHealthServer();
  startScheduler();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
