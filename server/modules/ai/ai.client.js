import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';

/**
 * The only place Kontaa talks to the AI provider. Tests replace the
 * client with setAiClient(); everything else calls getAiClient().
 */
let client = null;
let override = null;

export const aiConfigured = () => Boolean(override) || (env.ai.provider === 'anthropic' && Boolean(env.ai.apiKey));

export function getAiClient() {
  if (override) return override;
  if (!aiConfigured()) return null;
  client ??= new Anthropic({ apiKey: env.ai.apiKey, timeout: env.ai.timeoutMs, maxRetries: 2 });
  return client;
}

/** Test hook. Pass null to restore the real client. */
export function setAiClient(fake) {
  override = fake;
}

export { Anthropic };
