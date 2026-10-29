import React, { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { requestPasswordReset } from './api';

const schema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').email('Enter a valid email address'),
});

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), mode: 'onTouched' });

  const onSubmit = async (data) => {
    setError('');
    try {
      await requestPasswordReset(data);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not request a reset link. Please try again.');
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We’ll email a secure reset link if an account matches.">
      {sent ? (
        <div role="status" className="flex flex-col gap-5">
          <p className="rounded-lg border-2 border-[#183d2d] bg-white px-4 py-3 text-sm leading-relaxed">
            If an account uses that college email, a reset link is on its way. Check your inbox and spam folder.
          </p>
          <p className="text-sm text-center"><Link to="/login" className="font-bold text-[#c0392b] underline underline-offset-2">Back to log in</Link></p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Forgot password form" className="flex flex-col gap-5">
          {error && <p role="alert" className="rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] px-4 py-3 text-sm">{error}</p>}
          <div className="relative">
            <Input label="College email" id="forgot-email" type="email" placeholder="you@nitjsr.ac.in" autoComplete="email" error={errors.email?.message} {...register('email')} />
            <Mail size={16} className="absolute right-3 top-[34px] text-[#1a1a1a]/40 pointer-events-none" aria-hidden="true" />
          </div>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting} disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <p className="text-sm text-center"><Link to="/login" className="font-bold text-[#c0392b] underline underline-offset-2">Back to log in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
