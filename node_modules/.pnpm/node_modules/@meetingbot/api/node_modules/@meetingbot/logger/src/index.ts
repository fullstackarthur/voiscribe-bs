import pino from "pino";

export type LoggerContext = {
  meetingId?: string;
  workerId?: string;
  [key: string]: string | undefined;
};

const base = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export function createLogger(context: LoggerContext): pino.Logger {
  const bindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) bindings[key] = value;
  }
  return Object.keys(bindings).length > 0 ? base.child(bindings) : base;
}

export type Logger = pino.Logger;
