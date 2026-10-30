import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { AuthLayout } from './AuthLayout';
import { verifyOtp, resendOtp } from './api';
import { useAuthStore } from '../../stores/auth';
import { formatCountdown } from '../../lib/utils';
import { toast } from 'sonner';

const OTP_LENGTH = 6;
// Register and an unverified login have just sent a code; resend-otp answers retryAfter: 60.
const DEFAULT_COUNTDOWN = 60;

// Ticks a seconds counter down to 0.
function useCountdown(initial) {
  const [seconds, setSeconds] = useState(initial);
  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds];
}

export default function VerifyOtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  // Email comes either from router state (after register or login) or query param
  const email = (
    location.state?.email ??
    new URLSearchParams(location.search).get('email') ??
    ''
  )
    .trim()
    .toLowerCase();

  // OTP boxes
  const [digits, setDigits] = useState(Array(OTP_LENGTH).fill(''));
  const refs = useRef([]);

  // Countdowns: until resend is allowed, and until verify is allowed again after a 429
  const [countdown, setCountdown] = useCountdown(DEFAULT_COUNTDOWN);
  const [verifyLock, setVerifyLock] = useCountdown(0);

  // UI state
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false); // guards auto-submit firing twice before a re-render
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');

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

  const clearDigits = () => {
    setDigits(Array(OTP_LENGTH).fill(''));
    refs.current[0]?.focus();
  };

  // ── Verify ──────────────────────────────────────────────────────────────────
  const submitOtp = async (code) => {
    if (!email) {
      setError('Email missing — please go back and register again.');
      return;
    }
    if (verifyingRef.current) return;
    if (verifyLock > 0) {
      setError(`Too many attempts. Please wait ${formatCountdown(verifyLock)} before retrying.`);
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    setError('');
    try {
      // 200 { accessToken, user }: the email is verified and the session starts.
      const res = await verifyOtp({ email, otp: code });
      const { accessToken, user } = res.data;
      setSession(accessToken, user);
      toast.success('Email verified! Welcome to ShareX.');
      navigate('/verification', { replace: true });
    } catch (err) {
      // Reset digits so user can re-enter cleanly
      clearDigits();

      if (err.code === 'INVALID_OTP') {
        // The server says how many tries are left, or to request a new code once it's used up.
        setError(err.message || 'Invalid or expired code. Try again or resend.');
      } else if (err.code === 'RATE_LIMITED' || err.status === 429) {
        const retryAfter = err.retryAfter ?? 60;
        setVerifyLock(retryAfter);
        setError(`Too many attempts. Please wait ${formatCountdown(retryAfter)} before retrying.`);
      } else {
        setError(err.message ?? 'Verification failed. Please try again.');
        if (err.requestId) toast.error(`Error ref: ${err.requestId}`);
      }
    } finally {
      verifyingRef.current = false;
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
      // 200 { sent, retryAfter } whether or not the account exists (no enumeration).
      const res = await resendOtp({ email });
      setCountdown(res.data?.retryAfter ?? DEFAULT_COUNTDOWN);
      toast.success('New OTP sent! Check your inbox.');
      clearDigits();
    } catch (err) {
      if (err.code === 'RATE_LIMITED' || err.status === 429) {
        const retryAfter = err.retryAfter ?? 60;
        setCountdown(retryAfter);
        setError(`Rate limited. Try again in ${formatCountdown(retryAfter)}.`);
      } else {
        toast.error(err.message ?? 'Could not resend OTP.', {
          description: err.requestId ? `ref: ${err.requestId}` : undefined,
        });
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
          disabled={filled < OTP_LENGTH || verifying || verifyLock > 0}
          className="w-full"
        >
          {verifying
            ? 'Verifying…'
            : verifyLock > 0
              ? `Try again in ${formatCountdown(verifyLock)}`
              : 'Verify →'}
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

