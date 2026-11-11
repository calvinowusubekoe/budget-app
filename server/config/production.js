/**
 * Settings that are fine for development but unsafe in production. The
 * server refuses to start in production while any `errors` remain; `warnings`
 * are logged.
 *
 * @param {Record<string, any>} v  validated environment values
 * @param {Record<string, string|undefined>} raw  the raw environment (to tell "set" from "defaulted")
 */
export function productionProblems(v, raw) {
  const errors = [];
  const warnings = [];

  if (!raw.MONGODB_URI) errors.push('MONGODB_URI must be set (the default points at a local development database).');
  if (!/^https:\/\//.test(v.CLIENT_URL)) errors.push('CLIENT_URL must be an https:// address.');
  if (v.COOKIE_SECURE !== true) errors.push('COOKIE_SECURE must be true so session cookies only travel over HTTPS.');
  if (!v.SMTP_HOST) {
    // A tester build may run without email: messages are written to the server log instead.
    if (v.APP_STAGE === 'test') warnings.push('No SMTP: emails (verification, password reset, invitations) are only written to the server log. Fine for a test build, not for launch.');
    else errors.push('SMTP_HOST must be set: verification and password-reset emails are required.');
  }
  if (v.APP_STAGE === 'test') warnings.push('APP_STAGE=test: this is a tester build. Set APP_STAGE=live for launch.');
  if (/dev-only/.test(v.JWT_ACCESS_SECRET ?? '')) errors.push('JWT_ACCESS_SECRET must be a long random value, not the development default.');
  if (v.AI_PROVIDER === 'anthropic' && !v.ANTHROPIC_API_KEY) errors.push('AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is empty.');
  if (v.FLUTTERWAVE_SECRET_KEY && !v.FLUTTERWAVE_WEBHOOK_HASH) errors.push('FLUTTERWAVE_WEBHOOK_HASH is required with FLUTTERWAVE_SECRET_KEY, or webhooks cannot be verified.');
  for (const o of String(v.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!/^https:\/\//.test(o)) errors.push(`CORS_ORIGINS entry "${o}" must use https://.`);
  }

  if (/^sk_test_/.test(v.PAYSTACK_SECRET_KEY ?? '')) warnings.push('Paystack is using a TEST key: no real payments will be taken.');
  if (/^FLWSECK_TEST/.test(v.FLUTTERWAVE_SECRET_KEY ?? '')) warnings.push('Flutterwave is using a TEST key: no real payments will be taken.');
  if (v.TRUST_PROXY === false) warnings.push('TRUST_PROXY is off. Behind a load balancer or reverse proxy, set it (e.g. 1) so rate limits see real client IPs.');
  if (v.UPLOAD_STORAGE !== 'mongodb' && v.UPLOAD_DIR === 'uploads') warnings.push('UPLOAD_DIR is the default local folder. Mount it on persistent storage and include it in backups.');
  return { errors, warnings };
}
