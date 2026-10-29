import React, { useEffect, useState } from 'react';
import { CheckCircle2, QrCode, RefreshCw, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { errorMessage } from '../../../lib/errors';
import { formatIstTime } from '../../../lib/time';
import { useNow } from '../../resources/hooks';
import { useBookingPass, usePassStatus } from '../api';
import { passSecondsLeft } from './passView';

// The borrower's QR booking pass (frontend.md FC-05): on an approved booking (pickup) and while the
// item is out or awaiting return confirmation (return). Open, it shows a QR the unit's manager scans
// at /manage/scan, a 6-character code for typing in instead, and how long the pass is valid. The pass
// is fetched again every minute (it lasts 2), and while it's open and not yet verified a light status
// read every 15 s says when the unit has scanned it; both stop once it's verified. Times come from the
// server (issuedAt, expiresAt, verifiedAt), so a phone whose clock is off still counts down right.

const card =
  'rounded-xl border-2 border-[#1a1a1a] bg-white p-4 sm:p-5 shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a]';

const formatCode = (code) => (code ? `${code.slice(0, 3)}-${code.slice(3)}` : null);

function PassBody({ bookingId, title, onPhase }) {
  const status = usePassStatus(bookingId);
  const verifiedAt = status.data?.data?.verifiedAt ?? null;
  const [showAgain, setShowAgain] = useState(false);
  const showPass = !verifiedAt || showAgain;
  const pass = useBookingPass(bookingId, { enabled: showPass, refresh: showPass });
  const now = useNow(1000);
  const [qr, setQr] = useState({ token: null, url: null });
  const data = pass.data?.data;
  const phase = data?.phase ?? status.data?.data?.phase ?? null;

  useEffect(() => {
    if (phase) onPhase(phase);
  }, [phase, onPhase]);

  // Draw the QR for each new token (qrcode loads with this card, not with the page).
  useEffect(() => {
    if (!data?.token) return undefined;
    let current = true;
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(data.token, { errorCorrectionLevel: 'M', margin: 1, width: 240 }))
      .then((url) => current && setQr({ token: data.token, url }))
      .catch(() => current && setQr({ token: data.token, url: null }));
    return () => {
      current = false;
    };
  }, [data?.token]);

  const left = data ? passSecondsLeft(data, pass.dataUpdatedAt, now) : null;
  // A pass that couldn't be refreshed, or ran out, mustn't be shown as if it still worked.
  const stale = Boolean(data) && (left === 0 || (pass.isError && !pass.isFetching));
  const verifiedText = verifiedAt ? `Verified by the unit at ${formatIstTime(verifiedAt)} IST.` : '';

  return (
    <div className="space-y-4">
      {/* One live region, always present, so the change to "Verified" is announced. */}
      <p role="status" className="sr-only">
        {verifiedText}
      </p>

      {verifiedAt && (
        <div className="flex flex-wrap items-start justify-between gap-3 p-3 rounded-lg border-2 border-[#1e7e45] bg-[#f0faf5]">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-[#1e7e45] shrink-0" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-black">{verifiedText}</p>
              <p className="text-[#1a1a1a]/80">
                {phase === 'return' ? 'Carry on with the return.' : 'You can check in now.'}
              </p>
            </div>
          </div>
          {!showAgain && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAgain(true)}>
              Show the pass again
            </Button>
          )}
        </div>
      )}

      {showPass &&
        (pass.isPending ? (
          <p className="text-sm">Getting your pass…</p>
        ) : !data ? (
          <div role="alert" className="text-sm p-3 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] space-y-2">
            <p className="font-bold">Couldn&apos;t get your pass. {errorMessage(pass.error)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => pass.refetch()} loading={pass.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <div className="relative w-[200px] h-[200px] shrink-0 rounded-lg border-2 border-[#1a1a1a] bg-white flex items-center justify-center overflow-hidden">
              {qr.url && qr.token === data.token ? (
                <img
                  src={qr.url}
                  width={196}
                  height={196}
                  alt={`QR booking pass for ${title}.`}
                  className={stale ? 'opacity-15 blur-sm' : undefined}
                />
              ) : (
                <span className="text-xs text-[#1a1a1a]/70">Drawing the QR…</span>
              )}
              {stale && (
                <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center bg-white/70">
                  <p className="text-xs font-bold">This pass has run out.</p>
                  <Button type="button" variant="forest" size="sm" onClick={() => pass.refetch()} loading={pass.isFetching}>
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Get a new one
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2 text-sm text-center sm:text-left">
              <p>
                Show this to the unit&apos;s staff at {phase === 'return' ? 'return' : 'pickup'}. They scan it and check
                your college ID.
              </p>
              {data.code && !stale && (
                <p>
                  <span className="block text-[11px] uppercase tracking-wider text-[#1a1a1a]/70">Or tell them the code</span>
                  <span className="text-2xl font-black tracking-[0.2em]" aria-hidden="true">
                    {formatCode(data.code)}
                  </span>
                  <span className="sr-only">{data.code.split('').join(' ')}</span>
                </p>
              )}
              {!stale && (
                <p className="text-xs text-[#1a1a1a]/75">
                  {left === null ? 'Refreshes every minute.' : `Valid for ${left} s; refreshes every minute.`}
                </p>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

export function PassCard({ booking, title }) {
  const [open, setOpen] = useState(false);
  // The server's phase once a pass or status has been read; until then, from the booking.
  const [phase, setPhase] = useState(booking.status === 'approved' ? 'pickup' : 'return');
  return (
    <section aria-labelledby="pass-heading" data-tour="booking-pass" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pass-heading" className="text-base font-black tracking-tight flex items-center gap-2">
          <QrCode className="w-5 h-5 text-[#a93226]" aria-hidden="true" />
          Your {phase} pass
        </h2>
        {open ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            <X className="w-4 h-4" aria-hidden="true" />
            Hide
          </Button>
        ) : (
          <Button type="button" variant="forest" size="sm" onClick={() => setOpen(true)}>
            <QrCode className="w-4 h-4" aria-hidden="true" />
            Show my pass
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-4">
          <PassBody bookingId={String(booking._id)} title={title} onPhase={setPhase} />
        </div>
      )}
    </section>
  );
}
