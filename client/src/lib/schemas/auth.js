import { z } from 'zod';

/** Campus email — must be @nitjsr.ac.in */
export const campusEmail = z
  .string()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .refine(
    (v) => v.toLowerCase().endsWith('@nitjsr.ac.in'),
    'Use your college email (@nitjsr.ac.in)'
  );

/** Password: 8–72 chars, at least one letter and one digit */
export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(72, 'At most 72 characters')
  .refine((v) => /[a-zA-Z]/.test(v), 'Must contain at least one letter')
  .refine((v) => /\d/.test(v), 'Must contain at least one digit');

/** Display name */
export const displayName = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name is too long');

/** 6-digit OTP */
export const otpCode = z
  .string()
  .length(6, 'Enter the 6-digit code')
  .regex(/^\d{6}$/, 'Only digits allowed');

/** Password strength score (0–4) */
export function passwordStrength(pwd) {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^a-zA-Z\d]/.test(pwd)) score++;
  return Math.min(score, 4);
}

