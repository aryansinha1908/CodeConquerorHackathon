import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, Keyboard, ScanLine, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { errorMessage } from '../../lib/errors';
import { formatIstRange } from '../../lib/time';
import { useScanPass } from '../bookings/api';
import { memberTypeLabel } from '../verification/api';
import { LinkButton } from './components/Bits';
import { cameraAdvice, cameraPreflight, cleanCode, isPassText } from './components/scanView';

// /manage/scan (frontend.md FC-05): the unit's side of the QR booking pass. Scan the borrower's QR with
// the camera, or type the 6-character code on their pass. The server checks it's a pass of one of this
// manager's units, at the right time, records it on the booking's history, and says what comes next:
// the check-in, the borrower's check-out, or the return confirmation. Scanning only verifies; each
// step is still taken on its own page.

const card =
  'rounded-xl border-2 border-[#1a1a1a] bg-white p-4 sm:p-5 shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a]';

function NextStep({ result }) {
  const id = encodeURIComponent(String(result.booking._id));
  const name = result.booking.borrower?.name ?? 'The borrower';
  if (result.next === 'check_in') {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {name} can check in on their phone now, or you can check them in here: tick the checklist together.
        </p>
        <LinkButton to={`/bookings/${id}/check-in`} variant="forest">
          Open the check-in
        </LinkButton>
      </div>
    );
  }
  if (result.next === 'check_out') {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {name} is returning it: they check out on their phone, or you can do it here. Then confirm the return.
        </p>
        <LinkButton to={`/bookings/${id}/check-out`} variant="forest">
          Open the check-out
        </LinkButton>
      </div>
    );
  }
  if (result.next === 'confirm_return') {
    return (
      <div className="space-y-2">
        <p className="text-sm">{name} has checked out. Compare the condition reports and confirm the return.</p>
        <LinkButton to={`/manage/returns/${id}`} variant="forest">
          Confirm the return
        </LinkButton>
      </div>
    );
  }
  return null;
}

/** The verified pass. Exported for the tests. */
export function ScanResult({ result, onReset }) {
  const { booking } = result;
  const borrower = booking.borrower ?? {};
  return (
    <section aria-labelledby="scan-result-heading" className={`${card} border-[#1e7e45] space-y-4`}>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-7 h-7 text-[#1e7e45] shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="scan-result-heading" tabIndex={-1} className="text-lg font-black tracking-tight focus:outline-none">
            {result.phase === 'return' ? 'Return pass verified' : 'Pickup pass verified'}
          </h2>
          <p className="text-xs text-[#1a1a1a]/75">
            {result.recorded === false ? 'Already recorded on the booking\u2019s history.' : 'Recorded on the booking\u2019s history.'}{' '}
            Check their college ID against this name.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/70">Borrower</dt>
          <dd className="font-bold break-words">{borrower.name ?? 'Unknown'}</dd>
          <dd className="text-xs text-[#1a1a1a]/75">
            {[borrower.memberType && memberTypeLabel(borrower.memberType), borrower.department?.name].filter(Boolean).join(' · ')}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/70">Resource</dt>
          <dd className="font-bold break-words">{booking.resource?.title ?? 'Resource'}</dd>
          <dd className="text-xs text-[#1a1a1a]/75">{formatIstRange(booking.start, booking.end)} IST</dd>
        </div>
      </dl>
      {result.isOverdue && (
        <p className="text-sm font-bold text-[#a93226]">This return is late: the booking ended more than 15 minutes ago.</p>
      )}
      <NextStep result={result} />
      {!result.next && (
        <p className="text-sm text-[#1a1a1a]/80">
          The next step is for the borrower or one of the unit&apos;s managers.
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        <ScanLine className="w-4 h-4" aria-hidden="true" />
        Scan another pass
      </Button>
    </section>
  );
}

export default function ScanPage() {
  const ids = useId();
  const codeId = `${ids}-code`;
  const codeHintId = `${ids}-code-hint`;
  const errorId = `${ids}-error`;
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const resultRef = useRef(null);
  const codeRef = useRef(null);
  const errorRef = useRef(null);
  const [camera, setCamera] = useState({ state: 'off', advice: null });
  const [notPass, setNotPass] = useState(false);
  const [code, setCode] = useState('');
  const [codeHint, setCodeHint] = useState(false);
  const [lastMethod, setLastMethod] = useState(null);
  const scan = useScanPass();
  const result = scan.data?.data ?? null;

  // destroy() leaves qr-scanner's highlight overlay behind; remove it too.
  const dropScanner = () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    scanner.destroy();
    scanner.$overlay?.remove?.();
  };

  const stopCamera = () => {
    dropScanner();
    setCamera({ state: 'off', advice: null });
  };

  // Leaving the page turns the camera off.
  useEffect(() => dropScanner, []);

  // A verified pass takes focus, so screen readers hear it; an error is scrolled into view (on a
  // phone it would otherwise sit below the fold).
  useEffect(() => {
    if (result) resultRef.current?.querySelector('h2')?.focus();
  }, [result]);
  useEffect(() => {
    if (scan.isError) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [scan.isError]);

  const submit = (body, method) => {
    if (scan.isPending) return;
    setLastMethod(method);
    scan.mutate(body);
  };

  const startCamera = async () => {
    dropScanner();
    setNotPass(false);
    setCamera({ state: 'starting', advice: null });
    const problem = await cameraPreflight();
    if (problem) {
      setCamera({ state: 'error', advice: problem });
      return;
    }
    try {
      const { default: QrScanner } = await import('qr-scanner');
      const scanner = new QrScanner(
        videoRef.current,
        (decoded) => {
          const text = decoded?.data ?? '';
          // A QR that isn't a pass (a URL, a menu): say so and keep scanning.
          if (!isPassText(text)) {
            setNotPass(true);
            return;
          }
          dropScanner();
          setCamera({ state: 'off', advice: null });
          submit({ token: text.trim() }, 'camera');
        },
        { returnDetailedScanResult: true, preferredCamera: 'environment', highlightScanRegion: true, maxScansPerSecond: 5 },
      );
      scannerRef.current = scanner;
      await scanner.start();
      setCamera({ state: 'on', advice: null });
    } catch (err) {
      dropScanner();
      setCamera({ state: 'error', advice: cameraAdvice(err) });
    }
  };

  // After a result or an error: back to the code box, which keeps what was typed.
  const reset = () => {
    scan.reset();
    setLastMethod(null);
    setTimeout(() => codeRef.current?.focus(), 0);
  };

  const scanAnother = () => {
    setCode('');
    reset();
  };

  const codeReady = code.length === 6;
  const codeInvalid = lastMethod === 'code' && scan.isError;

  return (
    <section aria-labelledby="scan-heading" className="space-y-6 font-mono text-[#1a1a1a]">
      <div>
        <span className="text-xs uppercase font-bold text-[#c0392b] tracking-widest block mb-1">Handover check</span>
        <h1 id="scan-heading" className="text-2xl font-black tracking-tight">
          Scan a booking pass
        </h1>
        <p className="text-sm text-[#1a1a1a]/75 max-w-2xl">
          At pickup or return, the borrower opens their booking and shows its QR pass. Scanning it confirms it&apos;s a
          live pass for a booking of one of your units, at the right time, and records the check on its history.
          Then check their college ID against the name shown.
        </p>
      </div>

      {scan.isError && (
        <div ref={errorRef} id={errorId} role="alert" className="p-4 rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] text-sm flex items-start gap-3">
          <TriangleAlert className="w-5 h-5 shrink-0 text-[#c0392b]" aria-hidden="true" />
          <div className="space-y-2">
            <p className="font-bold">{errorMessage(scan.error)}</p>
            {scan.error?.requestId && <p className="text-xs text-[#1a1a1a]/70">ref: {scan.error.requestId}</p>}
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {result ? (
        <div ref={resultRef}>
          <ScanResult result={result} onReset={scanAnother} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <section aria-labelledby="scan-camera-heading" className={`${card} space-y-3`}>
            <h2 id="scan-camera-heading" className="text-base font-black tracking-tight flex items-center gap-2">
              <Camera className="w-4 h-4 text-[#a93226]" aria-hidden="true" />
              With the camera
            </h2>
            <div className="relative aspect-square w-full max-w-sm mx-auto rounded-lg border-2 border-[#1a1a1a] bg-[#1a1a1a] overflow-hidden">
              {/* qr-scanner draws into this element; muted and inline so phones don't open a player. */}
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline aria-label="Camera view" />
              {camera.state !== 'on' && (
                <div className="absolute inset-0 flex items-center justify-center text-white/80 text-xs text-center p-4">
                  {camera.state === 'starting' ? 'Starting the camera…' : 'The camera is off.'}
                </div>
              )}
            </div>
            {notPass && camera.state === 'on' && (
              <p className="text-sm" role="status">
                That QR isn&apos;t a CampusCommons pass. Point the camera at the pass on the borrower&apos;s booking page.
              </p>
            )}
            {camera.advice && (
              <p role="alert" className="text-sm p-3 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] flex items-start gap-2">
                <CameraOff className="w-4 h-4 mt-0.5 shrink-0 text-[#c0392b]" aria-hidden="true" />
                {camera.advice}
              </p>
            )}
            {camera.state === 'on' ? (
              <Button type="button" variant="outline" size="md" onClick={stopCamera}>
                <CameraOff className="w-4 h-4" aria-hidden="true" />
                Stop the camera
              </Button>
            ) : (
              <Button type="button" variant="forest" size="md" onClick={startCamera} loading={camera.state === 'starting'}>
                <Camera className="w-4 h-4" aria-hidden="true" />
                {camera.state === 'starting' ? 'Starting…' : 'Start the camera'}
              </Button>
            )}
          </section>

          <section aria-labelledby="scan-code-heading" className={`${card} space-y-3`}>
            <h2 id="scan-code-heading" className="text-base font-black tracking-tight flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-[#a93226]" aria-hidden="true" />
              Or type the code
            </h2>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!codeReady) {
                  setCodeHint(true);
                  codeRef.current?.focus();
                  return;
                }
                submit({ code }, 'code');
              }}
            >
              <label htmlFor={codeId} className="text-sm font-bold block">
                The 6 characters under the QR
              </label>
              <input
                ref={codeRef}
                id={codeId}
                value={code}
                onChange={(event) => {
                  setCode(cleanCode(event.target.value));
                  setCodeHint(false);
                }}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="K7Q2MX"
                aria-describedby={[codeHint ? codeHintId : null, codeInvalid ? errorId : null].filter(Boolean).join(' ') || undefined}
                aria-invalid={codeInvalid || codeHint || undefined}
                className="w-full max-w-xs px-3 py-2.5 rounded-lg border-2 border-[#1a1a1a] bg-white text-xl font-black tracking-[0.2em] uppercase focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
              />
              {codeHint && (
                <p id={codeHintId} className="text-xs font-bold text-[#a93226]">
                  Type all 6 characters ({code.length} so far).
                </p>
              )}
              <Button type="submit" variant="primary" size="md" loading={scan.isPending}>
                Verify the code
              </Button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
