import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Grid3X3,
  List,
  Upload,
  Play,
  Image as ImageIcon,
  Film,
  Scissors,
  X,
  Sparkles,
  HardDrive,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useFileUpload, type UploadedAsset } from "@/hooks/useFileUpload";
import DrivePickerModal from "@/components/DrivePickerModal";
import { useProcessingStore } from "@/store/processingStore";
import { DISPLAY_NAME_TO_PLATFORM } from "@/lib/captionPrompts";

// ── Constants ─────────────────────────────────────────────────────────────────

const filters = ["All", "Images", "Videos", "Clips", "Unscheduled"];

const platforms = [
  { name: "X", color: "bg-platform-x text-black" },
  { name: "Reddit", color: "bg-platform-reddit text-white" },
  { name: "Telegram Free", color: "bg-platform-telegram text-white" },
  { name: "Telegram VIP", color: "bg-platform-telegram text-white" },
  { name: "Website", color: "bg-platform-website text-white" },
];

const ACCEPTED_ATTR = "image/*,video/*";

// ── Component ─────────────────────────────────────────────────────────────────

export default function MediaLibrary() {
  const navigate = useNavigate();
  const { setProcessingJob } = useProcessingStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState("All");
  const [activePlatforms, setActivePlatforms] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  const handleProcess = () => {
    const selectedAssets = assets.filter(a => selected.includes(a.id));
    const platforms = activePlatforms.map(name => DISPLAY_NAME_TO_PLATFORM[name] ?? name);
    setProcessingJob(selectedAssets, platforms);
    navigate("/processing");
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const { assets, isProcessing, processFiles } = useFileUpload();

  // ── Filtered assets (real uploads only — no mocks) ────────────────────────

  const filteredAssets = assets.filter((a) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Images") return a.type === "IMAGE";
    if (activeFilter === "Videos") return a.type === "VIDEO";
    if (activeFilter === "Clips") return a.type === "CLIP";
    return true;
  });

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const togglePlatform = (name: string) =>
    setActivePlatforms((p) =>
      p.includes(name) ? p.filter((x) => x !== name) : [...p, name]
    );

  const hasSelection = selected.length > 0;

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      await processFiles(files);
      toast.success(`${files.length} file${files.length > 1 ? "s" : ""} added`);
    },
    [processFiles]
  );

  // ── Click to browse ────────────────────────────────────────────────────────

  const handleUploadClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;
      await processFiles(files);
      toast.success(`${files.length} file${files.length > 1 ? "s" : ""} added`);
      e.target.value = "";
    },
    [processFiles]
  );

  // ── Google Drive ───────────────────────────────────────────────────────────

  const handleDriveFiles = useCallback(
    async (files: File[]) => {
      await processFiles(files);
      toast.success(`${files.length} file${files.length > 1 ? "s" : ""} added from Drive`);
    },
    [processFiles]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Drive picker modal */}
      {showDrivePicker && (
        <DrivePickerModal
          onFilesSelected={handleDriveFiles}
          onClose={() => setShowDrivePicker(false)}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_ATTR}
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div className="flex h-full">
        {/* Center Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Top Bar */}
          <div className="flex items-center gap-3 border-b border-white/[0.08] px-6 py-4 glass-panel rounded-none border-x-0 border-t-0">
            <div className="flex flex-1 items-center gap-2 rounded-full glass-button px-4 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                placeholder="Search assets..."
                className="flex-1 bg-transparent text-body text-foreground placeholder:text-muted-foreground outline-none font-satoshi"
              />
            </div>
            <div className="flex items-center gap-1">
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`rounded-full px-3 py-1.5 text-micro font-medium transition-colors ${
                    activeFilter === f
                      ? "glass-accent text-white"
                      : "text-muted-foreground hover:text-foreground glass-button"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button className="rounded-md p-1.5 text-muted-foreground glass-button hover:text-foreground">
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button className="rounded-md p-1.5 text-muted-foreground glass-button hover:text-foreground">
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Upload zone */}
          <div
            className={`mx-6 mt-4 rounded-xl border border-dashed card-surface px-4 py-3 flex items-center cursor-pointer transition-all duration-200 ${
              isDragOver
                ? "border-accent-violet/70 bg-accent-violet/5"
                : "border-white/[0.12] hover:border-accent-violet/40"
            }`}
            onClick={handleUploadClick}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Spacer — balances Drive button */}
            <div className="w-24 shrink-0" />

            {/* Center prompt */}
            <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-body select-none">
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-satoshi">Processing…</span>
                </>
              ) : isDragOver ? (
                <>
                  <Upload className="h-4 w-4 text-accent-violet" />
                  <span className="font-satoshi text-accent-violet">Drop to add</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span className="font-satoshi">Drop files here or click to upload</span>
                </>
              )}
            </div>

            {/* Google Drive button */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowDrivePicker(true); }}
              className="w-24 shrink-0 flex items-center justify-end gap-1.5 text-micro text-muted-foreground hover:text-foreground transition-colors"
            >
              <HardDrive className="h-3.5 w-3.5" />
              <span className="font-satoshi">Drive</span>
            </button>
          </div>

          {/* Asset Grid / Empty State */}
          <div className="flex-1 overflow-auto p-6">
            {filteredAssets.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
                <div className="relative">
                  <div
                    className="w-24 h-24 rounded-2xl flex items-center justify-center"
                    style={{
                      background: "radial-gradient(ellipse at 50% 50%, rgba(124,92,246,0.15) 0%, transparent 70%)",
                    }}
                  >
                    <Upload className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="font-satoshi font-medium text-muted-foreground/60 text-body">
                    Drop your content here
                  </p>
                  <p className="font-satoshi text-muted-foreground/35 text-micro mt-1">
                    Images and videos will appear in a bento grid
                  </p>
                </div>
              </div>
            ) : (
              /* Bento asset grid */
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-auto">
                {filteredAssets.map((asset) => {
                  const isSelected = selected.includes(asset.id);
                  return (
                    <motion.div
                      key={asset.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggleSelect(asset.id)}
                      className={`group relative cursor-pointer rounded-xl overflow-hidden transition-shadow ${
                        asset.ratio === "portrait" ? "row-span-2" : ""
                      } ${isSelected ? "glow-ring" : ""}`}
                    >
                      <div
                        className={`w-full card-elevated relative ${
                          asset.ratio === "portrait"
                            ? "h-full min-h-[240px]"
                            : asset.ratio === "landscape"
                            ? "aspect-video"
                            : "aspect-square"
                        }`}
                      >
                        {/* Real thumbnail */}
                        {asset.previewUrl && (
                          <img
                            src={asset.previewUrl}
                            alt={asset.name}
                            className="absolute inset-0 w-full h-full object-cover"
                            draggable={false}
                          />
                        )}

                        {/* Fallback placeholder (no thumbnail) */}
                        {!asset.previewUrl && (
                          <>
                            <div className="absolute inset-0 atmospheric-glow opacity-30" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              {asset.type === "VIDEO" ? (
                                <Film className="h-8 w-8 text-muted-foreground/30" />
                              ) : asset.type === "CLIP" ? (
                                <Scissors className="h-8 w-8 text-muted-foreground/30" />
                              ) : (
                                <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                              )}
                            </div>
                          </>
                        )}

                        {/* Dark overlay */}
                        {asset.previewUrl && (
                          <div className="absolute inset-0 bg-black/15 group-hover:bg-black/25 transition-colors" />
                        )}

                        {/* Video: play + duration */}
                        {asset.duration && (
                          <>
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="rounded-full glass-button p-2">
                                <Play className="h-5 w-5 text-foreground" />
                              </div>
                            </div>
                            <span className="absolute bottom-2 left-2 rounded-md glass-button px-1.5 py-0.5 font-mono text-micro text-foreground">
                              {asset.duration}
                            </span>
                          </>
                        )}

                        {/* Type badge */}
                        <span className="absolute top-2 right-2 rounded-md glass-button px-1.5 py-0.5 text-micro font-mono text-muted-foreground">
                          {asset.type}
                        </span>

                        {/* Filename on hover */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-body text-foreground font-satoshi truncate block">{asset.name}</span>
                        </div>

                        {/* Selection check — inside bounds */}
                        {isSelected && (
                          <div className="absolute top-2 left-2 h-5 w-5 rounded-full glass-accent flex items-center justify-center">
                            <span className="text-micro font-bold text-white">✓</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel — Selection */}
        <AnimatePresence>
          {hasSelection && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="border-l border-white/[0.08] glass-panel overflow-hidden shrink-0"
            >
              <div className="w-[320px] flex flex-col h-full p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sub font-satoshi text-foreground">Selected</span>
                    <span className="rounded-full glass-accent px-2 py-0.5 text-micro font-bold text-white">
                      {selected.length}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelected([])}
                    className="text-micro text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                </div>

                {/* Selected thumbnails — X button inside bounds */}
                <div className="grid grid-cols-3 gap-2 mb-6">
                  {selected.slice(0, 9).map((id) => {
                    const asset = assets.find((a) => a.id === id) as UploadedAsset | undefined;
                    return (
                      <div
                        key={id}
                        className="aspect-square rounded-lg card-elevated relative group cursor-pointer overflow-hidden"
                      >
                        {asset?.previewUrl ? (
                          <img
                            src={asset.previewUrl}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                          </div>
                        )}
                        {/* X button — inside the container (top-1 right-1, not -top-1 -right-1) */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(id);
                          }}
                          className="absolute top-1 right-1 h-4 w-4 rounded-full bg-danger flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                        >
                          <X className="h-2.5 w-2.5 text-white" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Platform selection */}
                <div className="border-t border-white/[0.08] pt-4">
                  <span className="text-body text-muted-foreground font-satoshi">Publish to:</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {platforms.map((p) => {
                      const active = activePlatforms.includes(p.name);
                      return (
                        <button
                          key={p.name}
                          onClick={() => togglePlatform(p.name)}
                          className={`rounded-full px-3 py-1.5 text-micro font-medium transition-all ${
                            active ? p.color : "glass-button text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-micro text-muted-foreground/60 font-satoshi">
                    Censoring rules applied automatically per platform
                  </p>
                </div>

                {/* Process CTA */}
                <div className="mt-auto pt-6">
                  <button
                    onClick={handleProcess}
                    disabled={activePlatforms.length === 0}
                    className={`w-full rounded-full py-3 text-sub font-medium transition-all flex items-center justify-center gap-2 ${
                      activePlatforms.length > 0
                        ? "glass-accent text-white"
                        : "glass-button text-muted-foreground cursor-not-allowed"
                    }`}
                  >
                    Process <Sparkles className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
