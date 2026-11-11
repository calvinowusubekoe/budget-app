/* eslint-disable no-console */
const silent = process.env.NODE_ENV === 'test';

export const logger = {
  info: (...args) => !silent && console.log('[info]', ...args),
  warn: (...args) => !silent && console.warn('[warn]', ...args),
  error: (...args) => console.error('[error]', ...args),
};
