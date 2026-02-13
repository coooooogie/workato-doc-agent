import cron from "node-cron";
import { runDocumentationPipeline } from "./pipeline/orchestrator.js";
import { logger } from "./logger.js";

const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "0 */6 * * *";

let isRunning = false;

async function runPipeline() {
  if (isRunning) {
    logger.warn("Pipeline already running, skipping scheduled run");
    return;
  }
  isRunning = true;
  const correlationId = `run-${Date.now()}`;
  const log = logger.child({ correlationId });
  try {
    log.info("Starting scheduled documentation pipeline");
    await runDocumentationPipeline();
    log.info("Pipeline completed successfully");
  } catch (err) {
    log.error({ err }, "Pipeline failed");
  } finally {
    isRunning = false;
  }
}

export function startScheduler() {
  if (!cron.validate(CRON_SCHEDULE)) {
    throw new Error(`Invalid CRON_SCHEDULE: ${CRON_SCHEDULE}`);
  }
  cron.schedule(CRON_SCHEDULE, runPipeline, {
    scheduled: true,
    timezone: "UTC",
  });
  logger.info({ schedule: CRON_SCHEDULE }, "Scheduler started");
}
