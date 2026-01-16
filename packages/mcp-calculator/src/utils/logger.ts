import pino from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

/**
 * Production-grade structured logger
 */
export const logger = pino({
  level: logLevel,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
