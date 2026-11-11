import { z } from 'zod';

/** Mirrors the server's Joi rules so most mistakes are caught before a round trip. */
export const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use 72 characters or fewer.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.');

export const emailRule = z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.');

export const loginSchema = z.object({
  email: emailRule,
  password: z.string().min(1, 'Enter your password.'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(80),
  email: emailRule,
  password: passwordRule,
  defaultCurrency: z.string().length(3),
  acceptTerms: z.boolean().refine((v) => v, 'Accept the terms to continue.'),
  acceptPrivacy: z.boolean().refine((v) => v, 'Accept the privacy notice to continue.'),
  marketingConsent: z.boolean(),
});

export const forgotSchema = z.object({ email: emailRule });

export const resetSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
