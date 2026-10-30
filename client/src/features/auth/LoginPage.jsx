import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Mail, Timer } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import { DemoRoleSwitcher } from './DemoRoleSwitcher';
import { login as apiLogin, getDemoConfig } from './api';
import { useAuthStore } from '../../stores/auth';
import { formatCountdown } from '../../lib/utils';

// Only the format is checked here: the allowed domains are server config (ALLOWED_EMAIL_DOMAINS),
// demo accounts (@demo.campuscommons.test) may log in under DEMO_MODE, and any other address just
// gets INVALID_CREDENTIALS.
const schema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const FIELDS = ['email', 'password'];
const DEFAULT_NEXT = '/explore';
const AUTH_PAGES = ['/login', '/register', '/verify-otp'];

// ?next= comes from the URL, so only same-site paths are followed.
function safeNext(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_NEXT;
  }
  const path = value.split(/[?#]/)[0];
  return AUTH_PAGES.includes(path) ? DEFAULT_NEXT : value;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const setSession = useAuthStore((s) => s.setSession);
  const [showPwd, setShowPwd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Lockout countdown after a 429 (error.retryAfter: details.retryAfterSeconds or Retry-After)
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [lockoutMsg, setLockoutMsg] = useState('');

  // Demo mode: GET /auth/demo-config → { demoMode, roles }
  const [demoConfig, setDemoConfig] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
  });

  // ── Load demo config ─────────────────────────────────────────────────────────
  useEffect(() => {
    getDemoConfig()
      .then((res) => setDemoConfig(res.data))
      .catch(() => {}); // silently ignore — demo mode is optional
  }, []);

  // ── Lockout countdown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (lockoutSeconds <= 0) return undefined;
    const timer = setTimeout(() => setLockoutSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [lockoutSeconds]);

  // ── Session (login or demo login) ────────────────────────────────────────────
  const startSession = (accessToken, user) => {
    setSession(accessToken, user);
    navigate(next, { replace: true });
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const onSubmit = async (data) => {
    if (lockoutSeconds > 0) return;
    setIsSubmitting(true);
    try {
      const res = await apiLogin(data);
      const { accessToken, user } = res.data;
      toast.success('Welcome back!');
      startSession(accessToken, user);
    } catch (err) {
      const fieldErrors =
        err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)
          ? err.details.filter((d) => FIELDS.includes(d.path))
          : [];
      if (fieldErrors.length) {
        fieldErrors.forEach((d) => setError(d.path, { message: d.message }));
      } else if (err.code === 'INVALID_CREDENTIALS') {
        setError('password', { message: err.message || 'Email or password is incorrect.' });
      } else if (err.code === 'EMAIL_NOT_VERIFIED') {
        // The server has just sent a fresh code to this address.
        toast.info(err.message || 'Please verify your email first. We sent you a new code.');
        navigate('/verify-otp', { state: { email: data.email } });
      } else if (err.code === 'RATE_LIMITED' || err.status === 429) {
        setLockoutSeconds(err.retryAfter ?? 60);
        setLockoutMsg(err.message || 'Too many failed attempts.');
      } else {
        toast.error(err.message ?? 'Login failed', {
          description: err.requestId ? `ref: ${err.requestId}` : undefined,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLocked = lockoutSeconds > 0;

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to ShareX"
    >
      {/* Demo role switcher — only shown when DEMO_MODE */}
      {demoConfig?.demoMode && (
        <DemoRoleSwitcher roles={demoConfig.roles} onLogin={startSession} />
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        aria-label="Login form"
        className="flex flex-col gap-5"
      >
        {/* Lockout banner */}
        {isLocked && (
          <div
            role="alert"
            aria-live="assertive"
            className="bg-amber-50 border-2 border-amber-500 rounded-lg px-4 py-3 flex items-start gap-3"
          >
            <Timer size={18} className="text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 font-mono text-sm">
              <p className="font-bold text-amber-800">{lockoutMsg}</p>
              <p className="text-amber-700 text-xs mt-0.5 tabular-nums">
                Unlock in: <span className="font-bold">{formatCountdown(lockoutSeconds)}</span>
              </p>
            </div>
          </div>
        )}

        {/* Email */}
        <div className="relative">
          <Input
            label="College email"
            id="login-email"
            type="email"
            placeholder="2024ugcs001@nitjsr.ac.in"
            autoComplete="email"
            error={errors.email?.message}
            disabled={isLocked}
            {...register('email')}
          />
          <Mail
            size={16}
            className="absolute right-3 top-[34px] text-[#1a1a1a]/40 pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {/* Password */}
        <div className="relative">
          <Input
            label="Password"
            id="login-password"
            type={showPwd ? 'text' : 'password'}
            placeholder="Your password"
            autoComplete="current-password"
            error={errors.password?.message}
            disabled={isLocked}
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

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          disabled={isLocked || isSubmitting}
          className="w-full mt-1"
        >
          {isSubmitting ? 'Logging in…' : (
            <>
              <LogIn size={18} aria-hidden="true" />
              Log in
            </>
          )}
        </Button>

        {/* Register link */}
        <p className="text-sm text-center text-[#1a1a1a]/70 font-mono">
          New to ShareX?{' '}
          <Link
            to="/register"
            className="font-bold text-[#c0392b] underline underline-offset-2 hover:text-[#a93226]"
          >
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

