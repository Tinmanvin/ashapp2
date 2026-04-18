/**
 * Google Drive — OAuth-only integration
 *
 * Only requires VITE_GOOGLE_CLIENT_ID (a public value, not a secret).
 * No API key needed. Uses:
 *   - Google Identity Services (GIS) for the sign-in consent screen
 *   - Google Drive REST API v3 with the OAuth bearer token
 *
 * To get a Client ID:
 *   console.cloud.google.com → APIs & Services → Credentials
 *   → Create OAuth 2.0 Client ID → Web application
 *   → Add http://localhost:5174 and your production domain to Authorized JavaScript Origins
 */

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const isDriveAvailable = !!GOOGLE_CLIENT_ID;

/* ── Lazy GIS script loader ──────────────────────────────────────────────── */

let gisReady = false;

async function loadGis(): Promise<void> {
  if (gisReady) return;
  if (document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
    gisReady = true;
    return;
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => { gisReady = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}

/* ── Auth token ──────────────────────────────────────────────────────────── */

let cachedToken: string | null = null;
let tokenExpiry = 0;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  await loadGis();

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID!,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (res: any) => {
        if (res.error) {
          reject(new Error(res.error_description ?? res.error));
          return;
        }
        cachedToken = res.access_token as string;
        // expires_in is in seconds; cache for 5 minutes less to be safe
        tokenExpiry = Date.now() + (res.expires_in - 300) * 1000;
        resolve(cachedToken);
      },
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export function clearDriveToken() {
  cachedToken = null;
  tokenExpiry = 0;
}

/* ── Drive REST API ──────────────────────────────────────────────────────── */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  size?: string;
  createdTime?: string;
  imageMediaMetadata?: { width: number; height: number };
  videoMediaMetadata?: { width: number; height: number; durationMillis: string };
}

const MEDIA_QUERY =
  "(mimeType contains 'image/' or mimeType contains 'video/')" +
  " and trashed = false";

const FILE_FIELDS =
  "id,name,mimeType,thumbnailLink,size,createdTime,imageMediaMetadata,videoMediaMetadata";

export async function listDriveFiles(token: string, pageToken?: string): Promise<{
  files: DriveFile[];
  nextPageToken?: string;
}> {
  const params = new URLSearchParams({
    q: MEDIA_QUERY,
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: "50",
    orderBy: "createdTime desc",
    ...(pageToken ? { pageToken } : {}),
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Drive API error ${res.status}`);
  }

  return res.json();
}

/**
 * Download a Drive file and return it as a File object for processFiles().
 * Uses the Drive API's ?alt=media endpoint with the OAuth bearer token.
 */
export async function downloadDriveFile(
  token: string,
  file: DriveFile
): Promise<File> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) throw new Error(`Failed to download ${file.name}: ${res.status}`);

  const blob = await res.blob();
  return new File([blob], file.name, { type: file.mimeType });
}
