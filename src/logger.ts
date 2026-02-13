import pino from "pino";
import { v4 as uuidv4 } from "uuid";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level: LOG_LEVEL,
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createCorrelationLogger(correlationId?: string) {
  return logger.child({
    correlationId: correlationId ?? uuidv4(),
  });
}
