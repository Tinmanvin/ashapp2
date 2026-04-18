/**
 * Google Drive Picker integration
 *
 * Requires two env vars in .env.local:
 *   VITE_GOOGLE_API_KEY     — from Google Cloud Console (restricted to Picker API)
 *   VITE_GOOGLE_CLIENT_ID   — OAuth 2.0 Client ID (Web application type)
 *
 * Both are pending from Ash. Until they're set, openGoogleDrivePicker()
 * throws 'GOOGLE_NOT_CONFIGURED' so callers can show a friendly message.
 */

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const isGoogleDriveConfigured = !!(API_KEY && CLIENT_ID);

/* ── Lazy script loaders ─────────────────────────────────────────────────── */

let gapiReady = false;
let gisReady = false;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureGapi(): Promise<void> {
  if (gapiReady) return;
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).gapi.load('client:picker', () => { gapiReady = true; resolve(); });
  });
}

async function ensureGis(): Promise<void> {
  if (gisReady) return;
  await loadScript('https://accounts.google.com/gsi/client');
  gisReady = true;
}

/* ── Token request ───────────────────────────────────────────────────────── */

async function getAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (response: any) => {
        if (response.error) reject(new Error(response.error));
        else resolve(response.access_token as string);
      },
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export async function openGoogleDrivePicker(): Promise<DriveFile[]> {
  if (!isGoogleDriveConfigured) {
    throw new Error('GOOGLE_NOT_CONFIGURED');
  }

  await Promise.all([ensureGapi(), ensureGis()]);
  const accessToken = await getAccessToken();

  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;

    const view = new google.picker.View(google.picker.ViewId.DOCS_IMAGES_AND_VIDEOS);
    view.setMimeTypes([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
      'video/mp4', 'video/quicktime', 'video/webm',
    ].join(','));

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(API_KEY!)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const files: DriveFile[] = data.docs.map((doc: any) => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            url: doc.url,
          }));
          resolve(files);
        } else if (
          data.action === google.picker.Action.CANCEL ||
          data.action === 'loaded'
        ) {
          // 'loaded' fires when picker opens — ignore it
          if (data.action === google.picker.Action.CANCEL) resolve([]);
        }
      })
      .build();

    picker.setVisible(true);
  });
}
