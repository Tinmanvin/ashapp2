import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { type UploadedAsset } from '@/hooks/useFileUpload'

export interface WebsiteConfig {
  title: string;          // empty = use individual asset filenames
  categories: string[];   // at least 1 required
  tags: string[];         // optional
  thumbnailUrl: string;   // R2 public URL — empty = use asset.previewUrl
}

interface ProcessingStore {
  selectedAssets: UploadedAsset[]
  selectedPlatforms: string[]
  websiteConfig: WebsiteConfig | null
  setProcessingJob: (assets: UploadedAsset[], platforms: string[], websiteConfig?: WebsiteConfig | null) => void
  clear: () => void
}

export const useProcessingStore = create<ProcessingStore>()(
  persist(
    (set) => ({
      selectedAssets: [],
      selectedPlatforms: [],
      websiteConfig: null,
      setProcessingJob: (assets, platforms, websiteConfig = null) =>
        set({ selectedAssets: assets, selectedPlatforms: platforms, websiteConfig }),
      clear: () => set({ selectedAssets: [], selectedPlatforms: [], websiteConfig: null }),
    }),
    { name: 'blackmagic-processing-job' }
  )
)
