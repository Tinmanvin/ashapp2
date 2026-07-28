/**
 * r2.ts — Cloudflare R2 upload/delete helpers
 *
 * Small files (≤50MB):  stream through the Worker directly
 * Large files (>50MB):  Worker generates a presigned PUT URL → client uploads
 *                        directly to R2, bypassing the Worker timeout entirely
 */

import { supabase } from '@/lib/supabase';

const WORKER_URL = (import.meta.env.VITE_R2_WORKER_URL as string | undefined) ?? '';

const SMALL_FILE_LIMIT = 50 * 1024 * 1024; // 50 MB

/**
 * The Worker used to trust a shared VITE_R2_UPLOAD_SECRET, which shipped in the
 * public JS bundle — anyone who read it could DELETE the entire media library.
 * It now takes the caller's Supabase session instead, so uploading and deleting
 * require a real signed-in user.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in — cannot access media storage');
  return { Authorization: `Bearer ${token}` };
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload a File or Blob to R2. Returns the permanent public URL.
 *
 * @param file     The file / blob to upload
 * @param key      Storage key, e.g. "files/1234567890-abc.mp4"
 * @param onProgress  Optional progress callback (0–100), only fires for large files
 */
export async function uploadToR2(
  file: File | Blob,
  key: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  if (!WORKER_URL) {
    throw new Error('R2 not configured — set VITE_R2_WORKER_URL in .env.local');
  }

  if (file.size <= SMALL_FILE_LIMIT) {
    return uploadSmall(file, key);
  }
  return uploadLarge(file, key, onProgress);
}

async function uploadSmall(file: File | Blob, key: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('key', key);

  const res = await fetch(`${WORKER_URL}/upload/small`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`R2 small upload failed (${res.status}): ${msg}`);
  }

  const { url } = await res.json() as { url: string };
  return url;
}

async function uploadLarge(
  file: File | Blob,
  key: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  // 1. Ask Worker for a presigned URL
  const presignRes = await fetch(`${WORKER_URL}/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      key,
      contentType: file instanceof File ? file.type : 'application/octet-stream',
    }),
  });

  if (!presignRes.ok) {
    const msg = await presignRes.text().catch(() => presignRes.statusText);
    throw new Error(`R2 presign failed (${presignRes.status}): ${msg}`);
  }

  const { presignedUrl, publicUrl } = await presignRes.json() as {
    presignedUrl: string;
    publicUrl: string;
  };

  // 2. Upload directly to R2 via presigned URL
  //    Use XMLHttpRequest so we can track progress
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`R2 PUT failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('R2 PUT network error'));

    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader(
      'Content-Type',
      file instanceof File ? file.type : 'application/octet-stream'
    );
    xhr.send(file);
  });

  return publicUrl;
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete a file from R2 by its storage key.
 * Silently succeeds if the file does not exist.
 */
export async function deleteFromR2(key: string): Promise<void> {
  if (!WORKER_URL) return;

  await fetch(`${WORKER_URL}/file/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isR2Configured(): boolean {
  return !!WORKER_URL;
}
