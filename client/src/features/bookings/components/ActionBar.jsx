import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, ClipboardCheck, Clock, Gavel, LogIn, LogOut } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { canDo } from '../api';
import { canReportIssue, handoverBlock, handoverPath, reportIssuePath } from './bookingView';
import { linkButtonClass } from './styles';

/**
 * The booking's action bar (frontend.md §6.2), driven by GET /bookings/:id allowedActions: check in
 * and check out link to the wizards, cancel opens the confirm dialog, "Report an issue" goes to
 * /incidents/new?bookingId=…. A manager viewing the booking also gets links to the review queue and
 * the return check. Before the check-in window it says when check-in opens.
 */
export function ActionBar({ booking, user, now, onCancel }) {
  const id = booking._id;
  const pendingRequest = booking.status === 'pending' || booking.status === 'waitlisted';
  const checkInNote =
    booking.status === 'approved' && !canDo(booking, 'checkIn') ? handoverBlock(booking, 'check_in', now) : null;
  const review = ['approve', 'reject', 'waitlist'].some((action) => canDo(booking, action));
  const confirmReturn = canDo(booking, 'confirmOk') || canDo(booking, 'confirmIssue');
  const report = canReportIssue(booking, user, now);
  const cancel = canDo(booking, 'cancel');

  const any = canDo(booking, 'checkIn') || canDo(booking, 'checkOut') || review || confirmReturn || report || cancel;

  return (
    <section
      aria-labelledby="booking-actions-heading"
      className="rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df] p-4 shadow-[4px_4px_0_#1a1a1a] space-y-3"
    >
      <h2 id="booking-actions-heading" className="text-xs uppercase font-bold tracking-widest">
        What you can do
      </h2>
      {any ? (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          {canDo(booking, 'checkIn') && (
            <Link to={handoverPath(id, 'check_in')} className={linkButtonClass('forest')}>
              <LogIn className="w-4 h-4" aria-hidden="true" />
              Check in
            </Link>
          )}
          {canDo(booking, 'checkOut') && (
            <Link to={handoverPath(id, 'check_out')} className={linkButtonClass(booking.isOverdue ? 'primary' : 'forest')}>
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Check out
            </Link>
          )}
          {confirmReturn && (
            <Link to={`/manage/returns/${encodeURIComponent(id)}`} className={linkButtonClass('forest')}>
              <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
              Confirm the return
            </Link>
          )}
          {review && (
            <Link to="/manage/requests" className={linkButtonClass('outline')}>
              <Gavel className="w-4 h-4" aria-hidden="true" />
              Review in the requests queue
            </Link>
          )}
          {report && (
            <Link to={reportIssuePath(id)} className={linkButtonClass('outline')}>
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              Report an issue
            </Link>
          )}
          {cancel && (
            <Button
              type="button"
              variant="outline"
              size="md"
              className="bg-white min-h-[44px]"
              onClick={onCancel}
            >
              <Ban className="w-4 h-4 text-[#a93226]" aria-hidden="true" />
              {pendingRequest ? 'Cancel request' : 'Cancel booking'}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm">Nothing to do on this booking right now.</p>
      )}
      {checkInNote && (
        <p className="text-sm flex items-start gap-2">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-bold">{checkInNote.title}. </span>
            {checkInNote.message}
          </span>
        </p>
      )}
    </section>
  );
}
