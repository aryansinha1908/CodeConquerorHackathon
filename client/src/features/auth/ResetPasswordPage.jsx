import React, { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { resetPassword } from './api';

const schema = z.object({
  password: z.string().min(8, 'At least 8 characters').max(72, 'At most 72 characters')
    .refine((value) => /\p{L}/u.test(value), 'Must contain at least one letter')
    .refine((value) => /\d/.test(value), 'Must contain at least one digit'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  path: ['confirmPassword'], message: 'Passwords do not match',
});

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), mode: 'onTouched' });

  const onSubmit = async ({ password }) => {
    setError('');
    try {
      await resetPassword({ token, password });
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err.message || 'This reset link is invalid or expired. Request a new one.');
    }
  };

  return (
    <AuthLayout title="Choose a new password" subtitle="Use at least 8 characters, including a letter and a number.">
      {done ? (
        <div role="status" className="flex flex-col gap-5">
          <p className="rounded-lg border-2 border-[#183d2d] bg-white px-4 py-3 text-sm">Your password has been changed. Taking you to log in…</p>
          <Link to="/login" className="text-center text-sm font-bold text-[#c0392b] underline underline-offset-2">Go to log in</Link>
        </div>
      ) : !token ? (
        <div className="flex flex-col gap-5">
          <p role="alert" className="rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] px-4 py-3 text-sm">This reset link is missing or invalid. Request a new one.</p>
          <Link to="/forgot-password" className="text-center text-sm font-bold text-[#c0392b] underline underline-offset-2">Request a reset link</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Reset password form" className="flex flex-col gap-5">
          {error && <p role="alert" className="rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] px-4 py-3 text-sm">{error}</p>}
          <Input label="New password" id="reset-password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <Input label="Confirm new password" id="reset-confirm-password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting} disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Changing password…' : 'Change password'}
          </Button>
          <p className="text-sm text-center"><Link to="/login" className="font-bold text-[#c0392b] underline underline-offset-2">Back to log in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
