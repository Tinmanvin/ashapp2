import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, HardDrive, Globe, Loader2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import type { UploadedAsset } from "@/hooks/useFileUpload";
import { uploadToR2, isR2Configured } from "@/lib/r2";
import DrivePickerModal from "@/components/DrivePickerModal";
import type { WebsiteConfig } from "@/store/processingStore";

// Categories and tags mirrored from blackmagicmodel.com
// To fetch dynamically, replace with an API call to /api/publish/categories
const WEBSITE_CATEGORIES = [
  "Coming Soon",
  "Free",
  "Ladies Nights",
  "Private Parties",
  "Show Extra's & Highlights",
  "X-ventures",
];

const WEBSITE_TAGS = [
  "After Show Extra's",
  "Free",
  "Hen Party",
  "Ladies Night",
  "Smoke Test",
  "Thailand Ep",
  "UK Pleasure Boys",
  "X-ventures Ep",
];

interface Props {
  assets: UploadedAsset[];
  initialConfig: WebsiteConfig | null;
  onOk: (config: WebsiteConfig) => void;
  onClose: () => void;
}

export default function WebsiteSettingsModal({ assets, initialConfig, onOk, onClose }: Props) {
  const firstAsset = assets[0];
  const isBatch = assets.length > 1;

  const [title, setTitle] = useState(
    initialConfig?.title ?? (isBatch ? "" : (firstAsset?.name ?? ""))
  );
  const [categories, setCategories] = useState<string[]>(initialConfig?.categories ?? []);
  const [tags, setTags] = useState<string[]>(initialConfig?.tags ?? []);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState(
    initialConfig?.thumbnailUrl || firstAsset?.previewUrl || ""
  );
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  const thumbInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggleCategory = (cat: string) =>
    setCategories((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]);

  const toggleTag = (tag: string) =>
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);

  const handleThumbFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setThumbnailPreviewUrl(url);
    setThumbnailFile(file);
    e.target.value = "";
  }, []);

  const handleThumbnailFromDrive = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    setThumbnailPreviewUrl(URL.createObjectURL(file));
    setThumbnailFile(file);
  }, []);

  const handleOk = async () => {
    if (categories.length === 0) return;

    let finalThumbnailUrl = thumbnailPreviewUrl;

    if (thumbnailFile) {
      if (isR2Configured()) {
        setIsUploading(true);
        try {
          const key = `thumbs/custom-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          finalThumbnailUrl = await uploadToR2(thumbnailFile, key);
        } catch (err) {
          console.error("Thumbnail upload failed:", err);
          toast.error("Thumbnail upload failed — using default thumbnail");
          finalThumbnailUrl = firstAsset?.previewUrl ?? "";
        } finally {
          setIsUploading(false);
        }
      } else {
        finalThumbnailUrl = firstAsset?.previewUrl ?? "";
      }
    }

    onOk({ title, categories, tags, thumbnailUrl: finalThumbnailUrl });
  };

  const canConfirm = categories.length > 0 && !isUploading;

  return (
    <>
      {showDrivePicker && (
        <DrivePickerModal
          onFilesSelected={handleThumbnailFromDrive}
          onClose={() => setShowDrivePicker(false)}
        />
      )}

      <input
        ref={thumbInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleThumbFileChange}
      />

      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(10, 10, 11, 0.85)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="card-surface rounded-2xl w-full flex flex-col"
            style={{ maxWidth: 500 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <Globe className="h-4 w-4 text-[hsl(var(--platform-website))]" />
                <span className="font-satoshi font-semibold text-foreground text-sub">
                  Website Upload Settings
                </span>
                {isBatch && (
                  <span className="text-micro text-muted-foreground font-satoshi">
                    {assets.length} assets
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="h-7 w-7 rounded-full glass-button flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 flex flex-col gap-5">

              {/* Thumbnail */}
              <div>
                <label className="block text-micro font-satoshi text-muted-foreground uppercase tracking-wider mb-2">
                  Thumbnail
                </label>

                <div className="h-40 rounded-xl overflow-hidden card-elevated relative">
                  {thumbnailPreviewUrl ? (
                    <img
                      src={thumbnailPreviewUrl}
                      alt="Thumbnail preview"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      <div className="absolute inset-0 atmospheric-glow opacity-30" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    </>
                  )}
                </div>

                {/* Compact upload row — mirrors library upload zone */}
                <div
                  className="mt-2 rounded-lg border border-dashed border-white/[0.12] hover:border-[hsl(var(--accent-primary)/0.4)] px-3 py-2 flex items-center cursor-pointer transition-all duration-200 card-elevated"
                  onClick={() => thumbInputRef.current?.click()}
                >
                  <div className="flex flex-1 items-center gap-2 text-muted-foreground">
                    <Upload className="h-3.5 w-3.5" />
                    <span className="text-micro font-satoshi">Change thumbnail</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowDrivePicker(true); }}
                    className="flex items-center gap-1.5 text-micro text-muted-foreground hover:text-foreground transition-colors font-satoshi"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Drive</span>
                  </button>
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Title */}
              <div>
                <label className="block text-micro font-satoshi text-muted-foreground uppercase tracking-wider mb-2">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isBatch ? "Leave blank to use individual filenames" : "Enter title…"}
                  className="w-full rounded-lg px-3 py-2 text-body font-satoshi text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--accent-primary)/0.5)] transition-all"
                  style={{
                    background: "hsl(var(--bg-elevated) / 0.5)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                />
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Categories */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <label className="text-micro font-satoshi text-muted-foreground uppercase tracking-wider">
                    Category
                  </label>
                  <span className="text-micro font-satoshi text-[hsl(var(--danger)/0.7)]">
                    required
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {WEBSITE_CATEGORIES.map((cat) => {
                    const active = categories.includes(cat);
                    return (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={`rounded-full px-3 py-1.5 text-micro font-medium font-satoshi transition-all ${
                          active
                            ? "glass-accent text-white"
                            : "glass-button text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Tags */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <label className="text-micro font-satoshi text-muted-foreground uppercase tracking-wider">
                    Tags
                  </label>
                  <span className="text-micro font-satoshi text-muted-foreground/50">optional</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {WEBSITE_TAGS.map((tag) => {
                    const active = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full px-3 py-1.5 text-micro font-medium font-satoshi transition-all ${
                          active
                            ? "bg-white/[0.14] border border-white/20 text-foreground"
                            : "glass-button text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.08]">
              <button
                onClick={onClose}
                className="rounded-full glass-button px-5 py-2 text-body text-muted-foreground hover:text-foreground transition-colors font-satoshi"
              >
                Cancel
              </button>
              <button
                onClick={handleOk}
                disabled={!canConfirm}
                className={`rounded-full px-5 py-2 text-body font-semibold font-satoshi transition-all flex items-center gap-2 ${
                  canConfirm
                    ? "glass-accent text-white"
                    : "glass-button text-muted-foreground opacity-40 cursor-not-allowed"
                }`}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  "Okay"
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
