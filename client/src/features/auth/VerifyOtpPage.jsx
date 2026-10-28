import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { AuthLayout } from './AuthLayout';
import { verifyOtp, resendOtp } from './api';
import { useAuthStore } from '../../stores/auth';
import { formatCountdown } from '../../lib/utils';
import { toast } from 'sonner';

const OTP_LENGTH = 6;
const DEFAULT_COUNTDOWN = 60; // seconds until resend is allowed

export default function VerifyOtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setSession } = useAuthStore();

  // Email comes either from router state (after register) or query param
  const email =
    location.state?.email ??
    new URLSearchParams(location.search).get('email') ??
    '';

  // OTP boxes
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
  const refs = useRef([]);

  // Countdown
  const [countdown, setCountdown] = useState(DEFAULT_COUNTDOWN);
  const intervalRef = useRef(null);

  // UI state
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);

  // ── Countdown ticker ────────────────────────────────────────────────────────
  const startCountdown = useCallback((seconds = DEFAULT_COUNTDOWN) => {
    clearInterval(intervalRef.current);
    setCountdown(seconds);
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    startCountdown();
    return () => clearInterval(intervalRef.current);
  }, [startCountdown]);

  // Focus first box on mount
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // ── OTP box handlers ────────────────────────────────────────────────────────
  const updateDigit = (index, value) => {
    const next = [...digits];
    next[index] = value.replace(/\D/g, '').slice(-1); // only 1 digit
    setDigits(next);
    setError('');

    // Auto-advance
    if (next[index] && index < OTP_LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    if (next.every(Boolean)) {
      submitOtp(next.join(''));
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        updateDigit(index, '');
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        updateDigit(index - 1, '');
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill('');
    pasted.split('').forEach((ch, i) => {
      next[i] = ch;
    });
    setDigits(next);
    const lastFilled = Math.min(pasted.length, OTP_LENGTH - 1);
    refs.current[lastFilled]?.focus();
    if (next.every(Boolean)) submitOtp(next.join(''));
  };

  // ── Verify ──────────────────────────────────────────────────────────────────
  const submitOtp = async (code) => {
    if (!email) {
      setError('Email missing — please go back and register again.');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const res = await verifyOtp({ email, otp: code });
      const { accessToken } = res.data;
      setSession(accessToken);
      toast.success('Email verified! Welcome to CampusCommons.');
      navigate('/verification');
    } catch (err) {
      setAttempts((a) => a + 1);
      // Reset digits so user can re-enter cleanly
      setDigits(Array(OTP_LENGTH).fill(''));
      refs.current[0]?.focus();

      if (err.code === 'INVALID_OTP') {
        setError('Invalid or expired code. Try again or resend.');
      } else if (err.code === 'RATE_LIMITED') {
        const retryAfter = err.retryAfter ?? 60;
        startCountdown(retryAfter);
        setError(`Too many attempts. Please wait ${formatCountdown(retryAfter)} before retrying.`);
      } else {
        setError(err.message ?? 'Verification failed. Please try again.');
        if (err.requestId) toast.error(`Error ref: ${err.requestId}`);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const code = digits.join('');
    if (code.length < OTP_LENGTH) {
      setError('Enter all 6 digits.');
      return;
    }
    submitOtp(code);
  };

  // ── Resend ──────────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (!email || countdown > 0 || resending) return;
    setResending(true);
    setError('');
    try {
      const res = await resendOtp({ email });
      // Respect Retry-After from the response if present
      const wait = res.data?.retryAfter ?? DEFAULT_COUNTDOWN;
      startCountdown(wait);
      toast.success('New OTP sent! Check your inbox.');
      setDigits(Array(OTP_LENGTH).fill(''));
      refs.current[0]?.focus();
    } catch (err) {
      if (err.code === 'RATE_LIMITED') {
        const retryAfter = err.retryAfter ?? 60;
        startCountdown(retryAfter);
        setError(`Rate limited. Try again in ${formatCountdown(retryAfter)}.`);
      } else {
        toast.error(err.message ?? 'Could not resend OTP.');
      }
    } finally {
      setResending(false);
    }
  };

  const filled = digits.filter(Boolean).length;

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={
        email ? (
          <>
            We sent a 6-digit code to{' '}
            <span className="font-bold text-[#183d2d]">{email}</span>
          </>
        ) : (
          'Enter the 6-digit code from your email'
        )
      }
    >
      <form
        onSubmit={handleFormSubmit}
        noValidate
        aria-label="OTP verification form"
        className="flex flex-col gap-6"
      >
        {/* Verified icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[#183d2d] border-2 border-[#1a1a1a] flex items-center justify-center shadow-[3px_3px_0_#1a1a1a]">
            <ShieldCheck size={32} className="text-white" aria-hidden="true" />
          </div>
        </div>

        {/* OTP boxes */}
        <div
          role="group"
          aria-label="Enter your 6-digit OTP"
          className="flex justify-center gap-2"
          onPaste={handlePaste}
        >
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (refs.current[i] = el)}
              type="text"
              inputMode="numeric"
              pattern="[0-9]"
              maxLength={1}
              value={digit}
              onChange={(e) => updateDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
              aria-invalid={!!error}
              className={[
                'w-12 h-14 text-center text-xl font-bold font-mono rounded-lg border-2',
                'transition-all focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1',
                digit
                  ? 'bg-[#183d2d] text-white border-[#1a1a1a]'
                  : 'bg-white text-[#1a1a1a] border-[#1a1a1a]',
                error && !digit && 'border-[#c0392b]',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>

        {/* Progress indicator */}
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {digits.map((d, i) => (
            <div
              key={i}
              className={[
                'w-2 h-2 rounded-full transition-colors duration-200',
                d ? 'bg-[#183d2d]' : 'bg-[#1a1a1a]/20',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="bg-[#fff5f5] border-2 border-[#c0392b] rounded-lg px-4 py-2.5 text-sm font-semibold text-[#c0392b] font-mono"
          >
            ✕ {error}
          </div>
        )}

        {/* Submit */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={verifying}
          disabled={filled < OTP_LENGTH || verifying}
          className="w-full"
        >
          {verifying ? 'Verifying…' : 'Verify →'}
        </Button>

        {/* Resend */}
        <div className="text-center font-mono text-sm">
          {countdown > 0 ? (
            <p className="text-[#1a1a1a]/60">
              Resend code in{' '}
              <span className="font-bold tabular-nums text-[#183d2d]">
                {formatCountdown(countdown)}
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="inline-flex items-center gap-1.5 text-[#c0392b] font-bold underline underline-offset-2 hover:text-[#a93226] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={14} className={resending ? 'animate-spin' : ''} aria-hidden="true" />
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </div>

        {/* Back link */}
        <Link
          to="/register"
          className="inline-flex items-center gap-1.5 text-sm font-mono text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors self-center"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Back to register
        </Link>
      </form>
    </AuthLayout>
  );
}

