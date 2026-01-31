import { config } from '@/lib/config';

const isDebugEnabled = () => config.features.debugMode || import.meta.env.DEV;

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.warn(...args);
    }
  },
  error: (...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.error(...args);
    }
  },
};
