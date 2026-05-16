import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type UploadedAsset } from '@/hooks/useFileUpload';
import type { WebsiteConfig } from '@/store/processingStore';

export interface ScheduledAsset {
  asset: UploadedAsset;
  platforms: string[];
  captions: Record<string, string>;
  websiteConfig?: WebsiteConfig;
  scheduledAt?: string;   // ISO datetime — when to post
  confirmed?: boolean;    // true = saved to Supabase, immutable in UI
  dbStatus?: 'pending' | 'posting' | 'posted' | 'failed';
}

interface SchedulerStore {
  approvedQueue: ScheduledAsset[];
  scheduled: Record<string, ScheduledAsset[]>; // "YYYY-MM-DD" → items

  setApprovedQueue:      (items: ScheduledAsset[]) => void;
  scheduleItem:          (dateKey: string, item: ScheduledAsset) => void;
  unscheduleItem:        (dateKey: string, assetId: string) => void;
  deleteConfirmedItem:   (dateKey: string, assetId: string) => void;
  confirmSchedule:       (assetIds: string[]) => void;
  loadConfirmedSchedule: (byDate: Record<string, ScheduledAsset[]>) => void;
}

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set) => ({
      approvedQueue: [],
      scheduled: {},

      setApprovedQueue: (items) => set({ approvedQueue: items }),

      scheduleItem: (dateKey, item) =>
        set((s) => ({
          scheduled: {
            ...s.scheduled,
            [dateKey]: [...(s.scheduled[dateKey] ?? []), item],
          },
          approvedQueue: s.approvedQueue.filter((i) => i.asset.id !== item.asset.id),
        })),

      // Confirmed items are locked — silently ignore removal attempts
      unscheduleItem: (dateKey, assetId) =>
        set((s) => {
          const item = s.scheduled[dateKey]?.find((i) => i.asset.id === assetId);
          if (!item || item.confirmed) return s;
          return {
            scheduled: {
              ...s.scheduled,
              [dateKey]: (s.scheduled[dateKey] ?? []).filter((i) => i.asset.id !== assetId),
            },
            approvedQueue: [...s.approvedQueue, item],
          };
        }),

      // Remove a confirmed item from the calendar and restore it to the queue
      deleteConfirmedItem: (dateKey, assetId) =>
        set((s) => {
          // Try the given dateKey first, then fall back to searching all keys
          let foundKey = dateKey;
          let item = s.scheduled[dateKey]?.find((i) => i.asset.id === assetId);
          if (!item) {
            for (const [dk, items] of Object.entries(s.scheduled)) {
              const found = items.find((i) => i.asset.id === assetId);
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
              [foundKey]: (s.scheduled[foundKey] ?? []).filter((i) => i.asset.id !== assetId),
            },
            approvedQueue: [...s.approvedQueue, restored],
          };
        }),

      // Mark items as confirmed (saved to Supabase) — they become immutable
      confirmSchedule: (assetIds) =>
        set((s) => ({
          scheduled: Object.fromEntries(
            Object.entries(s.scheduled).map(([dk, items]) => [
              dk,
              items.map((i) =>
                assetIds.includes(i.asset.id)
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
    { name: 'blackmagic-scheduler' }
  )
);
