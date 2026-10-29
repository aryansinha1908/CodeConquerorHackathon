import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import http from '../../lib/http';
import { retryReads } from '../../lib/errors';
import { compressionWorkerOptions } from '../uploads/api';

// Badges API (frontend.md §6.2 /badges, §8.2; backend.md B-09, §5 Badge/UserBadge; judge steps 2-4).
// Members browse the catalogue (GET /badges), view their credentials and request statuses (GET /badges/mine),
// and submit new requests (POST /badges/:id/requests with optional note and evidence file).

export const BADGE_EVIDENCE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
export const BADGE_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const BADGE_NOTE_MAX = 500;

export const badgeKeys = {
  all: ['badges'],
  mine: ['badges', 'mine'],
  catalogue: (orgUnit) => ['badges', 'catalogue', { orgUnit: orgUnit ?? null }],
};

export const orgUnitKeys = {
  active: ['org-units', 'active'],
};

const unwrap = (res) => ({ data: res.data?.data, meta: res.data?.meta });
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Check evidence file validity before upload.
 */
export function checkEvidenceFile(file) {
  if (!file) return null;
  if (!BADGE_EVIDENCE_TYPES.includes(file.type)) {
    return 'Use a JPG, PNG, WEBP or PDF file.';
  }
  if (file.size > BADGE_EVIDENCE_MAX_BYTES) {
    return 'The file must be smaller than 5 MB.';
  }
  return null;
}

/**
 * Compresses images if needed before upload, leaves PDFs intact.
 */
export async function prepareEvidenceFile(file) {
  if (!file) return { file: null };
  const initialError = checkEvidenceFile(file);
  if (initialError) return { error: initialError };

  if (file.type.startsWith('image/')) {
    try {
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1600,
        ...compressionWorkerOptions(),
      };
      const compressed = await imageCompression(file, options);
      if (compressed.size < file.size) {
        return {
          file: new File([compressed], file.name, {
            type: compressed.type || file.type,
          }),
        };
      }
    } catch {
      // If client compression fails, use original file (server validates type & size)
    }
  }

  const error = checkEvidenceFile(file);
  return error ? { error } : { file };
}

/**
 * GET /badges?orgUnit= → Array of Badge objects
 */
export async function listBadges({ orgUnit } = {}) {
  const params = orgUnit ? { orgUnit } : {};
  return unwrap(await http.get('/badges', { params }));
}

/**
 * GET /badges/mine → Envelope with data: Array of UserBadge rows
 */
export async function getMyBadges() {
  const res = await http.get('/badges/mine');
  return res.data;
}

/**
 * POST /badges/:id/requests with optional note and optional evidence file.
 */
export async function requestBadge(badgeId, { note, file } = {}) {
  const cleanNote = text(note);
  if (file) {
    const form = new FormData();
    if (cleanNote) form.append('note', cleanNote);
    form.append('evidence', file, file.name);
    return unwrap(
      await http.post(`/badges/${encodeURIComponent(badgeId)}/requests`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );
  }

  const body = cleanNote ? { note: cleanNote } : {};
  return unwrap(
    await http.post(`/badges/${encodeURIComponent(badgeId)}/requests`, body)
  );
}

/**
 * GET /badge-requests/:id/evidence → { url, expiresAt }
 */
export async function getBadgeEvidenceUrl(id) {
  return unwrap(await http.get(`/badge-requests/${encodeURIComponent(id)}/evidence`));
}

/**
 * GET /org-units → active org units for catalogue filtering
 */
export async function getActiveOrgUnits() {
  const res = await http.get('/org-units');
  return res.data;
}

// ── TanStack Query Hooks ──────────────────────────────────────────────────────

export function useBadgesCatalogue({ orgUnit } = {}, options = {}) {
  return useQuery({
    queryKey: badgeKeys.catalogue(orgUnit),
    queryFn: () => listBadges({ orgUnit }),
    staleTime: 5 * 60 * 1000, // matches frontend.md §8.2 (5 min)
    retry: retryReads,
    ...options,
  });
}

export function useMyBadges(options = {}) {
  return useQuery({
    queryKey: badgeKeys.mine,
    queryFn: getMyBadges,
    staleTime: 60 * 1000,
    retry: retryReads,
    ...options,
  });
}

export function useActiveOrgUnits(options = {}) {
  return useQuery({
    queryKey: orgUnitKeys.active,
    queryFn: getActiveOrgUnits,
    staleTime: 5 * 60 * 1000,
    retry: retryReads,
    ...options,
  });
}

export function useRequestBadge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ badgeId, note, file }) => requestBadge(badgeId, { note, file }),
    onSuccess: () => {
      // Refresh my badges & badge requests queue
      queryClient.invalidateQueries({ queryKey: badgeKeys.mine });
      queryClient.invalidateQueries({ queryKey: ['badge-requests'] });
    },
  });
}

