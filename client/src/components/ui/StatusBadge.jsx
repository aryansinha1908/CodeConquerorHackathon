import React from 'react';
import {
  Clock,
  CheckCircle2,
  ListOrdered,
  XCircle,
  Ban,
  TimerOff,
  LogIn,
  LogOut,
  BadgeCheck,
  AlertTriangle,
  UserX,
  AlarmClock,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export function StatusBadge({ status, waitlistPosition, isOverdue = false, className, size = 'md' }) {
  const configs = {
    pending: {
      color: 'bg-[#e67e22] text-white border-[#1a1a1a]',
      icon: Clock,
      label: 'Awaiting review',
    },
    approved: {
      color: 'bg-[#183d2d] text-white border-[#1a1a1a]',
      icon: CheckCircle2,
      label: 'Approved',
    },
    waitlisted: {
      color: 'bg-[#8e44ad] text-white border-[#1a1a1a]',
      icon: ListOrdered,
      label: waitlistPosition ? `Waitlisted (#${waitlistPosition})` : 'Waitlisted',
    },
    rejected: {
      color: 'bg-[#c0392b] text-white border-[#1a1a1a]',
      icon: XCircle,
      label: 'Rejected',
    },
    cancelled: {
      color: 'bg-[#7f8c8d] text-white border-[#1a1a1a]',
      icon: Ban,
      label: 'Cancelled',
    },
    expired: {
      color: 'bg-[#95a5a6] text-white border-[#1a1a1a]',
      icon: TimerOff,
      label: 'Expired',
    },
    checked_in: isOverdue
      ? {
          color: 'bg-[#fff5f5] text-[#c0392b] border-[#c0392b] ring-2 ring-[#c0392b]/30',
          icon: AlarmClock,
          label: 'Overdue',
        }
      : {
          color: 'bg-[#2980b9] text-white border-[#1a1a1a]',
          icon: LogIn,
          label: 'In use',
        },
    checked_out: {
      color: 'bg-[#1abc9c] text-[#1a1a1a] border-[#1a1a1a]',
      icon: LogOut,
      label: 'Returned, awaiting confirmation',
    },
    completed: {
      color: 'bg-[#27ae60] text-white border-[#1a1a1a]',
      icon: BadgeCheck,
      label: 'Completed',
    },
    flagged: {
      color: 'bg-[#d35400] text-white border-[#1a1a1a]',
      icon: AlertTriangle,
      label: 'Issue reported',
    },
    no_show: {
      color: 'bg-[#c0392b]/90 text-white border-[#1a1a1a]',
      icon: UserX,
      label: 'No-show',
    },
  };

  const cfg = configs[status] || {
    color: 'bg-[#ede8df] text-[#1a1a1a] border-[#1a1a1a]',
    icon: Clock,
    label: status?.toUpperCase() || 'UNKNOWN',
  };

  const Icon = cfg.icon;

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3.5 py-1.5 gap-2',
  }[size] || 'text-xs px-2.5 py-1 gap-1.5';

  return (
    <span
      className={cn(
        'inline-flex items-center font-bold font-mono tracking-tight uppercase rounded-md border-2',
        'shadow-[2px_2px_0px_0px_#1a1a1a] select-none',
        cfg.color,
        sizeClasses,
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{cfg.label}</span>
    </span>
  );
}

