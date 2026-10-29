import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { Camera, ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from './ui/Button';
import { ErrorState } from './ui/ErrorState';
import { useAuthStore } from '../stores/auth';
import { fieldErrorsFrom, isRetryable } from '../lib/errors';
import { cn } from '../lib/utils';
import {
  MAX_PHOTOS,
  UPLOAD_IMAGE_TYPES,
  photoCompressionOptions,
  preparePhotos,
  toPhotoRefs,
  uploadImages,
} from '../features/uploads/api';

const defaultCompress = (file) => imageCompression(file, photoCompressionOptions(file));

// Phones get a "Take a photo" button that opens the camera (capture="environment"); elsewhere the
// attribute does nothing, so only the file picker is offered.
function prefersCamera() {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

const pickerClass =
  'relative inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-md border-2 border-[#1a1a1a] ' +
  'bg-white text-[#1a1a1a] text-sm font-bold font-mono tracking-tight cursor-pointer shadow-[3px_3px_0_#1a1a1a] ' +
  'hover:shadow-[1px_1px_0_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px] transition-all ' +
  'focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2';

function uploadAdvice(error, user, required) {
  if (!error) return null;
  if (error.status === 403 && user && user.verification?.status !== 'approved') {
    return (
      <>
        Photos can be added once your ID card is verified.{' '}
        <Link to="/verification" className="font-bold underline underline-offset-2 text-[#183d2d]">
          Check your verification
        </Link>
      </>
    );
  }
  if (error.status === 503) {
    return required
      ? 'Photo uploads are unavailable right now. Try again in a few minutes.'
      : 'Photos are optional here: you can carry on without them, or try again later.';
  }
  return null;
}

/**
 * Up to `max` (3) photos for a condition report or an incident (frontend.md §7 PhotoUploader).
 * Picked images are compressed (≤ 1 MB, 1600 px), uploaded through POST /uploads/images and reported
 * to the parent as `onChange([{ url, publicId }])`, the objects the booking and incident routes take.
 *
 * - `value`: the photos uploaded so far ([{ url, publicId }]); the parent owns the list.
 * - `photoLabel` and `subject` make the alt text: "Check-in photo 1 of 3, FDM 3D Printer".
 * - `error`: a field error from the parent's last submit (e.g. `photos.0`), shown under the photos.
 * - `onBusyChange(busy)`: true while photos are compressing or uploading; hold the submit until
 *   it is false again.
 * - `required`: whether the form needs at least one photo (only changes the wording).
 *
 * 403 (not verified, or suspended), 503 (uploads not configured or failed) and 429 come back as
 * the server's message with its request id; a failed batch can be sent again or discarded.
 */
export function PhotoUploader({
  value = [],
  onChange,
  max = MAX_PHOTOS,
  label = 'Photos',
  hint,
  photoLabel = 'Photo',
  subject,
  error,
  required = false,
  disabled = false,
  onBusyChange,
  compress = defaultCompress,
  className,
}) {
  const ids = useId();
  const user = useAuthStore((s) => s.user);
  const photos = toPhotoRefs(value);
  const [camera] = useState(prefersCamera);
  // { phase: 'preparing' | 'uploading' | 'failed', count, files?, previews?, error? }
  const [batch, setBatch] = useState(null);
  const [notes, setNotes] = useState([]);
  const [previews, setPreviews] = useState({}); // publicId → object URL of the photo picked here
  const [announcement, setAnnouncement] = useState('');

  const runRef = useRef(0);
  const valueRef = useRef(photos);
  const urlsRef = useRef(new Set());
  const removeRefs = useRef([]);
  const addRef = useRef(null);
  // Where focus goes after the next render: the index of a remove button, or 'add' (the picker).
  const focusRef = useRef(null);

  useEffect(() => {
    valueRef.current = toPhotoRefs(value);
  }, [value]);

  // Release every preview this uploader made when it goes away.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const busy = Boolean(batch && batch.phase !== 'failed');
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Focus after a removal, a retry or a discard, once the list has re-rendered: the next remove
  // button, else the picker, so it never falls to <body> with the element that had it.
  useEffect(() => {
    const want = focusRef.current;
    if (want === null) return;
    focusRef.current = null;
    const target =
      want === 'add'
        ? addRef.current
        : (removeRefs.current[Math.min(want, photos.length - 1)] ?? addRef.current);
    target?.focus();
  });

  const track = (file) => {
    const url = URL.createObjectURL(file);
    urlsRef.current.add(url);
    return url;
  };
  const release = (url) => {
    if (url && urlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(url);
    }
  };

  const room = Math.max(0, max - photos.length);
  const full = room === 0;
  const blocked = disabled || busy || full;

  const send = async (files, local) => {
    const run = ++runRef.current;
    setBatch({ phase: 'uploading', count: files.length, files, previews: local });
    setAnnouncement(files.length === 1 ? 'Uploading the photo…' : `Uploading ${files.length} photos…`);
    try {
      const { data } = await uploadImages(files);
      if (run !== runRef.current) return;
      const added = toPhotoRefs(data);
      setPreviews((current) => {
        const next = { ...current };
        added.forEach((photo, index) => {
          if (local[index]) next[photo.publicId] = local[index];
        });
        return next;
      });
      setBatch(null);
      const total = valueRef.current.length + added.length;
      onChange?.([...valueRef.current, ...added]);
      setAnnouncement(
        `${added.length} ${added.length === 1 ? 'photo' : 'photos'} added. ${total} of ${max}.`
      );
    } catch (err) {
      if (run !== runRef.current) return;
      setAnnouncement(''); // the error card is an alert of its own
      setBatch({ phase: 'failed', count: files.length, files, previews: local, error: err });
    }
  };

  const takeFiles = async (fileList) => {
    const picked = Array.from(fileList ?? []);
    if (!picked.length || disabled || busy) return;
    if (batch?.phase === 'failed') batch.previews?.forEach(release);
    if (full) {
      setBatch(null);
      setNotes([`You've added ${max} photos, the most allowed. Remove one to add another.`]);
      return;
    }
    const run = ++runRef.current;
    setNotes([]);
    setAnnouncement('');
    setBatch({ phase: 'preparing', count: Math.min(room, MAX_PHOTOS, picked.length) });
    const { files, notes: found } = await preparePhotos(picked, { room, compress });
    if (run !== runRef.current) return;
    setNotes(found);
    if (!files.length) {
      setBatch(null);
      return;
    }
    await send(files, files.map(track));
  };

  // The error card (and the button just pressed) goes away on retry: keep focus on the picker.
  const retry = () => {
    if (batch?.phase !== 'failed') return;
    focusRef.current = 'add';
    send(batch.files, batch.previews);
  };

  const discard = () => {
    batch?.previews?.forEach(release);
    runRef.current += 1;
    focusRef.current = 'add';
    setBatch(null);
  };

  const remove = (index) => {
    const photo = photos[index];
    if (!photo) return;
    release(previews[photo.publicId]);
    setPreviews((current) => {
      const next = { ...current };
      delete next[photo.publicId];
      return next;
    });
    onChange?.(photos.filter((_, i) => i !== index));
    setNotes([]);
    setAnnouncement(`Photo ${index + 1} removed. ${photos.length - 1} of ${max}.`);
    focusRef.current = photos.length - 1 > 0 ? index : 'add';
  };

  const onPick = (event) => {
    const files = event.target.files;
    takeFiles(files);
    event.target.value = ''; // so picking the same file again still fires onChange
  };
  // A busy or full picker keeps its focus (aria-disabled, never disabled) and just doesn't open.
  const guardClick = (event) => {
    if (blocked) event.preventDefault();
  };

  const altFor = (index, count) =>
    `${photoLabel} ${index + 1} of ${count}${subject ? `, ${subject}` : ''}`;
  const pending = batch && batch.phase !== 'preparing' ? batch.previews ?? [] : [];
  const shownCount = photos.length + pending.length;

  const labelId = `${ids}-label`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const statusId = `${ids}-status`;
  const fileId = `${ids}-files`;
  const cameraId = `${ids}-camera`;
  // A 400 names the file in details (images.1 "Must be a JPG, PNG or WebP file."): show that line.
  const batchError =
    batch?.phase === 'failed'
      ? (() => {
          const detail = Object.values(fieldErrorsFrom(batch.error))[0];
          return detail ? { ...batch.error, message: detail } : batch.error;
        })()
      : null;
  const describedBy = [hintId, statusId, error && errorId].filter(Boolean).join(' ');
  const statusText = batch?.phase === 'preparing'
    ? `Preparing ${batch.count === 1 ? 'the photo' : `${batch.count} photos`}…`
    : batch?.phase === 'uploading'
      ? `Uploading ${batch.count === 1 ? 'the photo' : `${batch.count} photos`}…`
      : full
        ? `${max} of ${max} photos added.`
        : `${photos.length} of ${max} photos added.`;

  return (
    <fieldset className={cn('min-w-0 space-y-3 font-mono text-[#1a1a1a]', className)}>
      <legend id={labelId} className="text-sm font-bold tracking-tight">
        {label}
        {required ? '' : ' (optional)'}
      </legend>
      <p id={hintId} className="text-xs text-[#1a1a1a]/70 -mt-1">
        {hint ?? `Up to ${max} photos (JPG, PNG or WebP). They are compressed before upload.`}
      </p>

      {shownCount > 0 && (
        <ul className="grid grid-cols-3 gap-3 max-w-md" aria-label={`${label}: ${shownCount} of ${max}`}>
          {photos.map((photo, index) => {
            const alt = altFor(index, photos.length);
            return (
              <li key={photo.publicId} className="relative">
                <img
                  src={previews[photo.publicId] ?? photo.url}
                  alt={alt}
                  className="block w-full aspect-square object-cover rounded-lg border-2 border-[#1a1a1a] bg-[#f5f0e8]"
                />
                <button
                  ref={(node) => {
                    removeRefs.current[index] = node;
                  }}
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Remove ${alt}`}
                  className="absolute -top-2 -right-2 w-11 h-11 inline-flex items-center justify-center rounded-full border-2 border-[#1a1a1a] bg-white text-[#c0392b] shadow-[2px_2px_0_#1a1a1a] hover:bg-[#fff5f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {pending.map((url, index) => (
            <li key={url} className="relative">
              <img
                src={url}
                alt={`${batch?.phase === 'failed' ? 'Not uploaded' : 'Uploading'}: ${altFor(photos.length + index, shownCount)}`}
                className="block w-full aspect-square object-cover rounded-lg border-2 border-dashed border-[#1a1a1a] opacity-60"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase"
              >
                {batch?.phase === 'failed' ? (
                  <span className="px-1.5 py-0.5 rounded bg-[#c0392b] text-white">Not sent</span>
                ) : (
                  <Loader2 className="w-6 h-6 motion-safe:animate-spin" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {camera && (
          <label htmlFor={cameraId} className={cn(pickerClass, blocked && 'opacity-50 cursor-not-allowed shadow-none')}>
            <input
              id={cameraId}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPick}
              onClick={guardClick}
              aria-disabled={blocked || undefined}
              aria-describedby={describedBy}
              className="sr-only"
            />
            <Camera className="w-4 h-4" aria-hidden="true" />
            Take a photo
          </label>
        )}
        <label htmlFor={fileId} className={cn(pickerClass, blocked && 'opacity-50 cursor-not-allowed shadow-none')}>
          <input
            ref={addRef}
            id={fileId}
            type="file"
            accept={UPLOAD_IMAGE_TYPES.join(',')}
            multiple={room > 1}
            onChange={onPick}
            onClick={guardClick}
            aria-disabled={blocked || undefined}
            aria-describedby={describedBy}
            className="sr-only"
          />
          <ImagePlus className="w-4 h-4" aria-hidden="true" />
          {photos.length ? 'Add more photos' : camera ? 'Choose photos' : 'Add photos'}
        </label>
        {/* Not a live region: progress and counts are announced once, by the status below. */}
        <span id={statusId} className="text-xs text-[#1a1a1a]/70">
          {statusText}
        </span>
      </div>

      <div role="status">
        {notes.length > 0 && (
          <ul className="text-xs text-[#a04000] space-y-0.5">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>

      {batchError && (
        <div className="space-y-2">
          <ErrorState
            error={batchError}
            title={batch.count === 1 ? "The photo wasn't uploaded" : "The photos weren't uploaded"}
            onRetry={isRetryable(batch.error) ? retry : undefined}
          >
            {uploadAdvice(batch.error, user, required)}
          </ErrorState>
          <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={discard}>
            {batch.count === 1 ? 'Discard this photo' : 'Discard these photos'}
          </Button>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
          <span aria-hidden="true">✕</span> {error}
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </fieldset>
  );
}
