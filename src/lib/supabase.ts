import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Types matching the DB schema ──────────────────────────────────────────────

export type AssetType = 'VIDEO' | 'IMAGE' | 'CLIP';
export type AssetStatus = 'uploaded' | 'processing' | 'ready' | 'scheduled' | 'published';
export type AssetRatio = 'landscape' | 'portrait' | 'square';

export interface Asset {
  id: string;
  filename: string;
  file_url: string | null;
  thumbnail_url: string | null;
  type: AssetType;
  ratio: AssetRatio;
  duration_secs: number | null;
  size_bytes: number | null;
  episode_tag: string | null;
  tags: string[];
  source: 'local' | 'drive';
  status: AssetStatus;
  uploaded_at: string;
  updated_at: string;
}
