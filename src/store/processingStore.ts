import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { type UploadedAsset } from '@/hooks/useFileUpload'

interface ProcessingStore {
  selectedAssets: UploadedAsset[]
  selectedPlatforms: string[]
  setProcessingJob: (assets: UploadedAsset[], platforms: string[]) => void
  clear: () => void
}

export const useProcessingStore = create<ProcessingStore>()(
  persist(
    (set) => ({
      selectedAssets: [],
      selectedPlatforms: [],
      setProcessingJob: (assets, platforms) => set({ selectedAssets: assets, selectedPlatforms: platforms }),
      clear: () => set({ selectedAssets: [], selectedPlatforms: [] }),
    }),
    { name: 'blackmagic-processing-job' }
  )
)
