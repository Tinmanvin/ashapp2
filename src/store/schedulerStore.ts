import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type UploadedAsset } from '@/hooks/useFileUpload';
import type { WebsiteConfig } from '@/store/processingStore';

/**
 * A scheduled post. ALWAYS a "group of N":
 *   - assets.length === 1  → single post (unchanged behaviour)
 *   - assets.length  >  1  → native album (Telegram) / multi-image tweet (X)
 *
 * `groupId` is the stable identity for the whole post across every platform.
 * `assets` is ordered — index 0 is the first item (carries the Telegram caption).
 * `captions` is keyed by platform (ONE caption per platform for the whole group).
 */
export interface ScheduledAsset {
  groupId: string;
  assets: UploadedAsset[];
  platforms: string[];
  captions: Record<string, string>;
  websiteConfig?: WebsiteConfig;
  scheduledAt?: string;   // ISO datetime — when to post
  confirmed?: boolean;    // true = saved to Supabase, immutable in UI
  dbStatus?: 'pending' | 'posting' | 'posted' | 'failed';
}

/** Convenience: the cover asset used for thumbnails/labels. */
export function coverAsset(item: ScheduledAsset): UploadedAsset | undefined {
  return item.assets[0];
}

/** Stable identity key for an item in queues/calendars. */
export function groupKey(item: ScheduledAsset): string {
  return item.groupId;
}

interface SchedulerStore {
  approvedQueue: ScheduledAsset[];
  scheduled: Record<string, ScheduledAsset[]>; // "YYYY-MM-DD" → items

  setApprovedQueue:      (items: ScheduledAsset[]) => void;
  mergeApprovedQueue:    (items: ScheduledAsset[]) => void;
  clearApprovedQueue:    () => void;
  scheduleItem:          (dateKey: string, item: ScheduledAsset) => void;
  unscheduleItem:        (dateKey: string, groupId: string) => void;
  deleteConfirmedItem:   (dateKey: string, groupId: string) => void;
  confirmSchedule:       (groupIds: string[]) => void;
  loadConfirmedSchedule: (byDate: Record<string, ScheduledAsset[]>) => void;
}

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set) => ({
      approvedQueue: [],
      scheduled: {},

      setApprovedQueue: (items) => set({ approvedQueue: items }),

      mergeApprovedQueue: (items) =>
        set((s) => {
          const existing = new Set(s.approvedQueue.map((i) => i.groupId));
          const newItems = items.filter((i) => !existing.has(i.groupId));
          return { approvedQueue: [...s.approvedQueue, ...newItems] };
        }),

      clearApprovedQueue: () => set({ approvedQueue: [] }),

      scheduleItem: (dateKey, item) =>
        set((s) => ({
          scheduled: {
            ...s.scheduled,
            [dateKey]: [...(s.scheduled[dateKey] ?? []), item],
          },
          approvedQueue: s.approvedQueue.filter((i) => i.groupId !== item.groupId),
        })),

      // Confirmed items are locked — silently ignore removal attempts
      unscheduleItem: (dateKey, groupId) =>
        set((s) => {
          const item = s.scheduled[dateKey]?.find((i) => i.groupId === groupId);
          if (!item || item.confirmed) return s;
          return {
            scheduled: {
              ...s.scheduled,
              [dateKey]: (s.scheduled[dateKey] ?? []).filter((i) => i.groupId !== groupId),
            },
            approvedQueue: [...s.approvedQueue, item],
          };
        }),

      // Remove a confirmed item from the calendar and restore it to the queue
      deleteConfirmedItem: (dateKey, groupId) =>
        set((s) => {
          // Try the given dateKey first, then fall back to searching all keys
          let foundKey = dateKey;
          let item = s.scheduled[dateKey]?.find((i) => i.groupId === groupId);
          if (!item) {
            for (const [dk, items] of Object.entries(s.scheduled)) {
              const found = items.find((i) => i.groupId === groupId);
              if (found) { item = found; foundKey = dk; break; }
            }
          }
          if (!item) return s;
          const restored: ScheduledAsset = {
            ...item,
            confirmed: false,
            dbStatus: undefined,
            scheduledAt: undefined,
          };
          return {
            scheduled: {
              ...s.scheduled,
              [foundKey]: (s.scheduled[foundKey] ?? []).filter((i) => i.groupId !== groupId),
            },
            approvedQueue: [...s.approvedQueue, restored],
          };
        }),

      // Mark items as confirmed (saved to Supabase) — they become immutable
      confirmSchedule: (groupIds) =>
        set((s) => ({
          scheduled: Object.fromEntries(
            Object.entries(s.scheduled).map(([dk, items]) => [
              dk,
              items.map((i) =>
                groupIds.includes(i.groupId)
                  ? { ...i, confirmed: true, dbStatus: 'pending' as const }
                  : i
              ),
            ])
          ),
        })),

      // Replace all confirmed items with fresh Supabase data; keep unconfirmed
      loadConfirmedSchedule: (byDate) =>
        set((s) => {
          const unconfirmedByDate: Record<string, ScheduledAsset[]> = {};
          for (const [dk, items] of Object.entries(s.scheduled)) {
            const unconfirmed = items.filter((i) => !i.confirmed);
            if (unconfirmed.length) unconfirmedByDate[dk] = unconfirmed;
          }

          const merged: Record<string, ScheduledAsset[]> = { ...byDate };
          for (const [dk, items] of Object.entries(unconfirmedByDate)) {
            merged[dk] = [...(merged[dk] ?? []), ...items];
          }
          return { scheduled: merged };
        }),
    }),
    {
      name: 'blackmagic-scheduler',
      version: 2, // bumped: asset → assets[]; drop incompatible persisted state
      migrate: () => ({ approvedQueue: [], scheduled: {} }),
    }
  )
);
