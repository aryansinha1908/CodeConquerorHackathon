import React, { useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, User, Mail } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import { EmailChip } from './EmailChip';
import { PasswordStrengthBar } from './PasswordStrengthBar';
import { register as apiRegister } from './api';
import { campusEmail, password as passwordSchema, displayName, passwordStrength } from '../../lib/schemas/auth';
import { getEmailChip } from '../../lib/emailPattern';
import { formatCountdown } from '../../lib/utils';
import { toast } from 'sonner';

const schema = z
  .object({
    name: z.string().trim().pipe(displayName),
    email: z.string().trim().toLowerCase().pipe(campusEmail),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

// Server field paths (VALIDATION_ERROR details) that this form can show.
const FIELDS = ['name', 'email', 'password'];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Seconds left after a 429 from the register limiter.
  const [retryIn, setRetryIn] = useState(0);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
  });

  // Watch live for chip and strength bar
  const watchedEmail = useWatch({ control, name: 'email', defaultValue: '' });
  const watchedPassword = useWatch({ control, name: 'password', defaultValue: '' });
  const emailChip = getEmailChip(watchedEmail);
  const strength = passwordStrength(watchedPassword);

  useEffect(() => {
    if (retryIn <= 0) return undefined;
    const timer = setTimeout(() => setRetryIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [retryIn]);

  const onSubmit = async (data) => {
    if (retryIn > 0) return;
    setIsSubmitting(true);
    try {
      // 201 { email, otpSent }: also the answer for an existing unverified account (fresh code).
      const res = await apiRegister({ name: data.name, email: data.email, password: data.password });
      toast.success('Check your email for the 6-digit code.');
      navigate('/verify-otp', { state: { email: res.data?.email ?? data.email } });
    } catch (err) {
      const fieldErrors =
        err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)
          ? err.details.filter((d) => FIELDS.includes(d.path))
          : [];
      if (fieldErrors.length) {
        fieldErrors.forEach((d) => setError(d.path, { message: d.message }));
      } else if (err.code === 'EMAIL_TAKEN') {
        setError('email', { message: 'This email is already registered. Try logging in.' });
      } else if (err.code === 'RATE_LIMITED' || err.status === 429) {
        const wait = err.retryAfter ?? 60;
        setRetryIn(wait);
        toast.error(err.message || 'Too many sign-up attempts.', {
          description: `Try again in ${formatCountdown(wait)}.${err.requestId ? ` (ref ${err.requestId})` : ''}`,
        });
      } else {
        toast.error(err.message ?? 'Something went wrong', {
          description: err.requestId ? `ref: ${err.requestId}` : undefined,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Join ShareX"
      subtitle="Sign up with your NIT JSR college email"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-5"
        aria-label="Registration form"
      >
        {/* Name */}
        <div className="relative">
          <Input
            label="Full name"
            id="reg-name"
            type="text"
            placeholder="Yash Sharma"
            autoComplete="name"
            error={errors.name?.message}
            {...register('name')}
          />
          <User
            size={16}
            className="absolute right-3 top-[34px] text-[#1a1a1a]/40 pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1">
          <div className="relative">
            <Input
              label="College email"
              id="reg-email"
              type="email"
              placeholder="2024ugcs001@nitjsr.ac.in"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
            <Mail
              size={16}
              className="absolute right-3 top-[34px] text-[#1a1a1a]/40 pointer-events-none"
              aria-hidden="true"
            />
          </div>

          {/* Live "Detected:" chip. A domain outside ALLOWED_EMAIL_DOMAINS comes back from the
              server as a VALIDATION_ERROR on `email`, shown as this field's error. */}
          {emailChip && !errors.email && (
            <EmailChip text={emailChip} />
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1">
          <div className="relative">
            <Input
              label="Password"
              id="reg-password"
              type={showPwd ? 'text' : 'password'}
              placeholder="Min 8 characters"
              autoComplete="new-password"
              error={errors.password?.message}
              hint={!errors.password ? '8–72 characters, at least one letter and one digit' : undefined}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPwd((p) => !p)}
              className="absolute right-3 top-[34px] text-[#1a1a1a]/50 hover:text-[#1a1a1a] transition-colors"
              aria-label={showPwd ? 'Hide password' : 'Show password'}
            >
              {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {watchedPassword && <PasswordStrengthBar strength={strength} />}
        </div>

        {/* Confirm password */}
        <div className="relative">
          <Input
            label="Confirm password"
            id="reg-confirm"
            type={showConfirm ? 'text' : 'password'}
            placeholder="Repeat your password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <button
            type="button"
            onClick={() => setShowConfirm((p) => !p)}
            className="absolute right-3 top-[34px] text-[#1a1a1a]/50 hover:text-[#1a1a1a] transition-colors"
            aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
          >
            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting || retryIn > 0}
          className="mt-2 w-full"
        >
          {isSubmitting
            ? 'Creating account…'
            : retryIn > 0
              ? `Try again in ${formatCountdown(retryIn)}`
              : 'Create account →'}
        </Button>

        {/* Login link */}
        <p className="text-sm text-center text-[#1a1a1a]/70 font-mono">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-bold text-[#c0392b] underline underline-offset-2 hover:text-[#a93226]"
          >
            Log in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

