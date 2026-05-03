import { useState, useCallback, useEffect } from 'react';
import { supabase, type Asset, type AssetType, type AssetRatio } from '@/lib/supabase';
import { uploadToR2, deleteFromR2, isR2Configured } from '@/lib/r2';

// ── Shape used by the UI ──────────────────────────────────────────────────────

export interface UploadedAsset {
  id: string;
  name: string;
  type: AssetType;
  ratio: AssetRatio;
  duration?: string;            // "2:34" display format
  previewUrl: string;           // thumbnail URL for display
  size: number;
  source: 'local' | 'drive';
  status: Asset['status'];
  uploadedAt: string;
  uploadProgress?: number;      // 0-100 during large file uploads
  episodeTag: string | null;    // content category (Episode, Clip, BTS, etc.)
}

// ── Thumbnail helpers ─────────────────────────────────────────────────────────

const MAX_THUMB = 600;

async function thumbnailFromImage(file: File): Promise<{
  dataUrl: string;
  ratio: AssetRatio;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, MAX_THUMB / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.72),
        ratio: w > h * 1.2 ? 'landscape' : h > w * 1.2 ? 'portrait' : 'square',
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ dataUrl: '', ratio: 'square' });
    };
    img.src = url;
  });
}

async function thumbnailFromVideo(file: File): Promise<{
  dataUrl: string;
  ratio: AssetRatio;
  durationSecs: number;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const done = () => {
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 360;
      const scale = Math.min(1, MAX_THUMB / Math.max(vw, vh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.72),
        ratio: vw > vh * 1.2 ? 'landscape' : vh > vw * 1.2 ? 'portrait' : 'square',
        durationSecs: Math.floor(video.duration) || 0,
      });
    };

    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0.5; }, { once: true });
    video.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      resolve({ dataUrl: '', ratio: 'landscape', durationSecs: 0 });
    }, { once: true });
  });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function dbAssetToUi(asset: Asset): UploadedAsset {
  return {
    id: asset.id,
    name: asset.filename.replace(/\.[^/.]+$/, ''),
    type: asset.type,
    ratio: asset.ratio,
    duration: asset.duration_secs ? formatDuration(asset.duration_secs) : undefined,
    previewUrl: asset.thumbnail_url ?? '',
    size: asset.size_bytes ?? 0,
    source: asset.source,
    status: asset.status,
    uploadedAt: asset.uploaded_at,
    episodeTag: asset.episode_tag ?? null,
  };
}

// ── Storage key helpers ───────────────────────────────────────────────────────

function makeStorageKey(filename: string): string {
  const ext = filename.split('.').pop() ?? 'bin';
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `files/${uid}.${ext}`;
}

function makeThumbKey(storageKey: string): string {
  return `thumbs/${storageKey.replace(/^files\//, '')}.jpg`;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        await fn(item);
      }
    })
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFileUpload() {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Load all existing assets from Supabase on mount ────────────────────────
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .order('uploaded_at', { ascending: false });

      if (!error && data) {
        setAssets((data as Asset[]).map(dbAssetToUi));
      }
      setIsLoading(false);
    }
    load();
  }, []);

  // ── Process + upload files ─────────────────────────────────────────────────
  const processFiles = useCallback(async (files: File[]) => {
    const accepted = files.filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (!accepted.length) return;

    const r2Ready = isR2Configured();
    setIsProcessing(true);

    try { await runConcurrent(accepted, 6, async (file) => {
      const isVideo = file.type.startsWith('video/');

      // 1. Generate thumbnail + extract metadata locally
      let thumbnailDataUrl = '';
      let ratio: AssetRatio = 'square';
      let durationSecs: number | undefined;
      let type: AssetType = 'IMAGE';

      if (isVideo) {
        const meta = await thumbnailFromVideo(file);
        thumbnailDataUrl = meta.dataUrl;
        ratio = meta.ratio;
        durationSecs = meta.durationSecs;
        type = 'VIDEO';
      } else {
        const meta = await thumbnailFromImage(file);
        thumbnailDataUrl = meta.dataUrl;
        ratio = meta.ratio;
        type = 'IMAGE';
      }

      const storageKey = makeStorageKey(file.name);
      const thumbKey = makeThumbKey(storageKey);

      // 2. Optimistic add to UI immediately so the user sees the thumbnail
      const tempId = `temp-${storageKey}`;
      const optimisticAsset: UploadedAsset = {
        id: tempId,
        name: file.name.replace(/\.[^/.]+$/, ''),
        type,
        ratio,
        duration: durationSecs ? formatDuration(durationSecs) : undefined,
        previewUrl: thumbnailDataUrl,
        size: file.size,
        source: 'local',
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
        uploadProgress: 0,
        episodeTag: null,
      };
      setAssets((prev) => [optimisticAsset, ...prev]);

      try {
        let fileUrl = '';
        let thumbnailUrl = '';

        if (r2Ready) {
          // Prepare thumbnail blob so both uploads can fire in parallel
          const thumbBlobForR2 = thumbnailDataUrl
            ? await (await fetch(thumbnailDataUrl)).blob()
            : null;

          // 3a+3b. Upload file and thumbnail to R2 in parallel
          [fileUrl, thumbnailUrl] = await Promise.all([
            uploadToR2(file, storageKey, (pct) => {
              setAssets((prev) =>
                prev.map((a) =>
                  a.id === tempId ? { ...a, uploadProgress: pct } : a
                )
              );
            }),
            thumbBlobForR2
              ? uploadToR2(thumbBlobForR2, thumbKey)
              : Promise.resolve(''),
          ]);
        } else {
          // 3c. Fallback: Supabase Storage (≤50MB, good for images + short clips)
          const { error: uploadError } = await supabase.storage
            .from('assets')
            .upload(storageKey, file, { contentType: file.type, upsert: false });

          if (uploadError) {
            console.error('Storage upload failed:', uploadError.message);
            setAssets((prev) => prev.filter((a) => a.id !== tempId));
            return;
          }

          fileUrl = supabase.storage.from('assets').getPublicUrl(storageKey).data.publicUrl;

          if (thumbnailDataUrl) {
            const thumbRes = await fetch(thumbnailDataUrl);
            const thumbBlob = await thumbRes.blob();
            const { error: thumbError } = await supabase.storage
              .from('assets')
              .upload(thumbKey, thumbBlob, { contentType: 'image/jpeg', upsert: false });

            if (!thumbError) {
              thumbnailUrl = supabase.storage.from('assets').getPublicUrl(thumbKey).data.publicUrl;
            }
          }
        }

        // 4. Save metadata row to Supabase
        const { data: inserted, error: dbError } = await supabase
          .from('assets')
          .insert({
            filename: file.name,
            file_url: fileUrl,
            thumbnail_url: thumbnailUrl || null,
            storage_key: storageKey,
            thumb_key: thumbKey,
            type,
            ratio,
            duration_secs: durationSecs ?? null,
            size_bytes: file.size,
            source: 'local',
            status: 'uploaded',
          })
          .select()
          .single();

        if (dbError) {
          console.error('DB insert failed:', dbError.message);
          setAssets((prev) => prev.filter((a) => a.id !== tempId));
          return;
        }

        // 5. Replace optimistic entry with real DB row
        setAssets((prev) =>
          prev.map((a) =>
            a.id === tempId ? dbAssetToUi(inserted as Asset) : a
          )
        );
      } catch (err) {
        console.error('Upload error:', err);
        setAssets((prev) => prev.filter((a) => a.id !== tempId));
      }
    }); } finally { setIsProcessing(false); }
  }, []);

  // ── Update episode tag ─────────────────────────────────────────────────────
  const updateEpisodeTag = useCallback(async (id: string, tag: string | null) => {
    setAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, episodeTag: tag } : a))
    );
    await supabase
      .from('assets')
      .update({ episode_tag: tag })
      .eq('id', id);
  }, []);

  // ── Remove single asset ────────────────────────────────────────────────────
  const removeAsset = useCallback(async (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));

    const { data: row } = await supabase
      .from('assets')
      .delete()
      .eq('id', id)
      .select('storage_key, thumb_key')
      .single();

    if (row) {
      const r2Ready = isR2Configured();
      if (r2Ready) {
        if (row.storage_key) deleteFromR2(row.storage_key).catch(() => {});
        if (row.thumb_key) deleteFromR2(row.thumb_key).catch(() => {});
      } else {
        if (row.storage_key) supabase.storage.from('assets').remove([row.storage_key]).catch(() => {});
        if (row.thumb_key) supabase.storage.from('assets').remove([row.thumb_key]).catch(() => {});
      }
    }
  }, []);

  // ── Remove multiple assets (batch) ─────────────────────────────────────────
  const removeAssets = useCallback(async (ids: string[]) => {
    if (!ids.length) return;

    setAssets((prev) => prev.filter((a) => !ids.includes(a.id)));

    const { data: rows } = await supabase
      .from('assets')
      .delete()
      .in('id', ids)
      .select('storage_key, thumb_key');

    if (rows?.length) {
      const r2Ready = isR2Configured();
      for (const row of rows) {
        if (r2Ready) {
          if (row.storage_key) deleteFromR2(row.storage_key).catch(() => {});
          if (row.thumb_key) deleteFromR2(row.thumb_key).catch(() => {});
        } else {
          if (row.storage_key) supabase.storage.from('assets').remove([row.storage_key]).catch(() => {});
          if (row.thumb_key) supabase.storage.from('assets').remove([row.thumb_key]).catch(() => {});
        }
      }
    }
  }, []);

  return { assets, isLoading, isProcessing, processFiles, removeAsset, removeAssets, updateEpisodeTag };
}
