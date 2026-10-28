import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, CheckCircle2, XCircle, User, Mail, Lock, Sparkles } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import { EmailChip } from './EmailChip';
import { PasswordStrengthBar } from './PasswordStrengthBar';
import { register as apiRegister } from './api';
import { campusEmail, password as passwordSchema, displayName, passwordStrength } from '../../lib/schemas/auth';
import { getEmailChip } from '../../lib/emailPattern';
import { toast } from 'sonner';

const schema = z
  .object({
    name: displayName,
    email: campusEmail,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export default function RegisterPage() {
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
    watch,
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
  });

  // Watch live for chip and strength bar
  const watchedEmail = watch('email', '');
  const watchedPassword = watch('password', '');
  const emailChip = getEmailChip(watchedEmail);
  const strength = passwordStrength(watchedPassword);

  const onSubmit = async (data) => {
    setIsSubmitting(true);
    try {
      await apiRegister({ name: data.name, email: data.email, password: data.password });
      toast.success('Account created! Check your email for the OTP.');
      navigate('/verify-otp', { state: { email: data.email } });
    } catch (err) {
      if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
        err.details.forEach((d) => setError(d.path, { message: d.message }));
      } else if (err.code === 'EMAIL_TAKEN') {
        setError('email', { message: 'This email is already registered. Try logging in.' });
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
      title="Join CampusCommons"
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

          {/* Live "Detected:" chip */}
          {emailChip && !errors.email && (
            <EmailChip text={emailChip} />
          )}

          {/* Inline domain error hint */}
          {!errors.email && watchedEmail && !watchedEmail.toLowerCase().endsWith('@nitjsr.ac.in') && watchedEmail.includes('@') && (
            <p className="text-xs font-semibold text-[#c0392b] flex items-center gap-1 mt-0.5">
              <XCircle size={12} aria-hidden="true" />
              Use your college email (@nitjsr.ac.in)
            </p>
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
          className="mt-2 w-full"
        >
          {isSubmitting ? 'Creating account…' : 'Create account →'}
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

