import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type UploadedAsset } from '@/hooks/useFileUpload';
import type { WebsiteConfig } from '@/store/processingStore';

export interface ScheduledAsset {
  asset: UploadedAsset;
  platforms: string[];
  captions: Record<string, string>; // platformId → caption body
  websiteConfig?: WebsiteConfig;
}

interface SchedulerStore {
  approvedQueue: ScheduledAsset[];
  scheduled: Record<string, ScheduledAsset[]>; // "YYYY-MM-DD" → items
  setApprovedQueue: (items: ScheduledAsset[]) => void;
  scheduleItem: (dateKey: string, item: ScheduledAsset) => void;
  unscheduleItem: (dateKey: string, assetId: string) => void;
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

      unscheduleItem: (dateKey, assetId) =>
        set((s) => {
          const item = s.scheduled[dateKey]?.find((i) => i.asset.id === assetId);
          return {
            scheduled: {
              ...s.scheduled,
              [dateKey]: (s.scheduled[dateKey] ?? []).filter((i) => i.asset.id !== assetId),
            },
            approvedQueue: item ? [...s.approvedQueue, item] : s.approvedQueue,
          };
        }),
    }),
    { name: 'blackmagic-scheduler' }
  )
);
