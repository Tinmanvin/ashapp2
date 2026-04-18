/**
 * assetDb — IndexedDB persistence for uploaded media assets.
 *
 * Stores everything locally in the browser so no page refresh clears state.
 * When Supabase credentials arrive this becomes a local cache / offline layer —
 * assets are synced to Supabase Storage + DB in the background.
 *
 * Schema
 * ──────
 * Database : ashapp-media  v1
 * Store    : assets        keyPath=id
 */

export type AssetType = 'VIDEO' | 'IMAGE' | 'CLIP';

export interface PersistedAsset {
  id: string;
  name: string;
  type: AssetType;
  ratio: 'landscape' | 'portrait' | 'square';
  duration?: string;      // "2:34" format for video/clips
  size: number;           // bytes
  source: 'local' | 'drive';
  uploadedAt: number;     // Date.now() timestamp
  thumbnailDataUrl: string; // data: URL — survives page reload (unlike object URLs)
  fileBlob: Blob;         // original file — kept for future Supabase upload
  synced: boolean;        // false until pushed to Supabase
}

const DB_NAME = 'ashapp-media';
const DB_VERSION = 1;
const STORE = 'assets';

// ── Open / init ───────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

export async function saveAsset(asset: PersistedAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllAssets(): Promise<PersistedAsset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('uploadedAt').getAll();
    req.onsuccess = () => {
      // Sort newest first
      const sorted = (req.result as PersistedAsset[]).sort(
        (a, b) => b.uploadedAt - a.uploadedAt
      );
      resolve(sorted);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllAssets(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Thumbnail generation helpers ──────────────────────────────────────────────
// Produce data: URLs (not object URLs) so they can be stored in IndexedDB
// and survive page reloads without reconstruction.

const MAX_THUMB_SIZE = 900; // px — max dimension of stored thumbnail

export async function generateImageThumbnail(file: File): Promise<{
  thumbnailDataUrl: string;
  ratio: 'landscape' | 'portrait' | 'square';
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, MAX_THUMB_SIZE / Math.max(w, h));
      const cw = Math.round(w * scale);
      const ch = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, cw, ch);

      URL.revokeObjectURL(url);
      resolve({
        thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.82),
        ratio: w > h * 1.2 ? 'landscape' : h > w * 1.2 ? 'portrait' : 'square',
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ thumbnailDataUrl: '', ratio: 'square' });
    };

    img.src = url;
  });
}

export async function generateVideoThumbnail(file: File): Promise<{
  thumbnailDataUrl: string;
  ratio: 'landscape' | 'portrait' | 'square';
  duration: string;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    const extractFrame = () => {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 360;
      const scale = Math.min(1, MAX_THUMB_SIZE / Math.max(vw, vh));

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const secs = Math.floor(video.duration) || 0;
      const m = Math.floor(secs / 60);
      const s = secs % 60;

      cleanup();
      resolve({
        thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.82),
        ratio: vw > vh * 1.2 ? 'landscape' : vh > vw * 1.2 ? 'portrait' : 'square',
        duration: `${m}:${String(s).padStart(2, '0')}`,
      });
    };

    video.addEventListener('seeked', extractFrame, { once: true });
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0.5; }, { once: true });
    video.addEventListener('error', () => {
      cleanup();
      resolve({ thumbnailDataUrl: '', ratio: 'landscape', duration: '0:00' });
    }, { once: true });
  });
}
