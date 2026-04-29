import { Component, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Edit3,
  Sparkles,
  ChevronDown,
  RotateCcw,
  Image as ImageIcon,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProcessingStore } from "@/store/processingStore";
import { supabase } from "@/lib/supabase";
import { generateCaption } from "@/lib/openai";
import { PLATFORM_META, type Platform } from "@/lib/captionPrompts";
import type { UploadedAsset } from "@/hooks/useFileUpload";

// ── Types ─────────────────────────────────────────────────────────────────────

type CaptionStatus = "pending" | "generating" | "ready" | "error";

interface CaptionEntry {
  body: string;
  status: CaptionStatus;
  errorMsg?: string;
}

function ck(assetId: string, platform: string) {
  return `${assetId}:${platform}`;
}

// ── Error Boundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center max-w-sm">
            <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-3" />
            <p className="text-body text-foreground font-satoshi mb-2">
              Something went wrong loading Processing.
            </p>
            <p className="text-micro text-muted-foreground font-mono mb-4">
              {(this.state.error as Error).message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="glass-button rounded-full px-5 py-2 text-body font-medium text-foreground"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

function ProcessingHubInner() {
  const navigate = useNavigate();
  const { selectedAssets, selectedPlatforms } = useProcessingStore();

  const [captions, setCaptions] = useState<Record<string, CaptionEntry>>({});
  const [expandedPlatforms, setExpandedPlatforms] = useState<string[]>(
    selectedPlatforms.length > 0 ? [selectedPlatforms[0]] : []
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const initialized = useRef(false);

  // ── Caption state helpers ─────────────────────────────────────────────────

  const setCaption = useCallback(
    (assetId: string, platform: string, patch: Partial<CaptionEntry>) => {
      const key = ck(assetId, platform);
      setCaptions((prev) => ({
        ...prev,
        [key]: { body: "", status: "pending", ...prev[key], ...patch },
      }));
    },
    []
  );

  // ── Load or generate a single caption ────────────────────────────────────

  const loadOrGenerate = useCallback(
    async (asset: UploadedAsset, platform: string) => {
      try {
        // Check if already in Supabase
        const { data } = await supabase
          .from("captions")
          .select("body")
          .eq("asset_id", asset.id)
          .eq("platform", platform)
          .maybeSingle();

        if (data?.body) {
          setCaption(asset.id, platform, { body: data.body, status: "ready" });
          return;
        }

        // Generate with OpenAI
        setCaption(asset.id, platform, { status: "generating" });
        const body = await generateCaption(
          asset.name,
          asset.type,
          platform as Platform
        );

        await supabase.from("captions").upsert(
          { asset_id: asset.id, platform, body, status: "ready" },
          { onConflict: "asset_id,platform" }
        );
        setCaption(asset.id, platform, { body, status: "ready" });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("Caption error", asset.name, platform, err);
        setCaption(asset.id, platform, { status: "error", errorMsg });
      }
    },
    [setCaption]
  );

  // ── On mount: initialise pending then stagger API calls ──────────────────

  useEffect(() => {
    if (initialized.current || !selectedAssets.length || !selectedPlatforms.length)
      return;
    initialized.current = true;

    // Set all to pending immediately so UI renders
    const initial: Record<string, CaptionEntry> = {};
    for (const asset of selectedAssets) {
      for (const platform of selectedPlatforms) {
        initial[ck(asset.id, platform)] = { body: "", status: "pending" };
      }
    }
    setCaptions(initial);

    // Stagger API calls so we don't hammer OpenAI in one burst
    selectedAssets.forEach((asset, ai) => {
      selectedPlatforms.forEach((platform, pi) => {
        const delay = (ai * selectedPlatforms.length + pi) * 150;
        setTimeout(() => loadOrGenerate(asset, platform), delay);
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup save timers on unmount
  useEffect(() => {
    return () => {
      saveTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // ── Edit / save ──────────────────────────────────────────────────────────

  function handleEditChange(
    key: string,
    assetId: string,
    platform: string,
    value: string
  ) {
    setEditDraft(value);
    const existing = saveTimers.current.get(key);
    if (existing) clearTimeout(existing);
    saveTimers.current.set(
      key,
      setTimeout(() => {
        supabase
          .from("captions")
          .upsert(
            { asset_id: assetId, platform, body: value, status: "ready" },
            { onConflict: "asset_id,platform" }
          )
          .then(() => setCaption(assetId, platform, { body: value }));
      }, 800)
    );
  }

  function commitEdit(assetId: string, platform: string) {
    const key = ck(assetId, platform);
    const existing = saveTimers.current.get(key);
    if (existing) clearTimeout(existing);
    supabase
      .from("captions")
      .upsert(
        { asset_id: assetId, platform, body: editDraft, status: "ready" },
        { onConflict: "asset_id,platform" }
      )
      .then(() => setCaption(assetId, platform, { body: editDraft }));
    setEditingKey(null);
  }

  async function handleRegenerate(asset: UploadedAsset, platform: string) {
    const key = ck(asset.id, platform);
    if (editingKey === key) setEditingKey(null);
    setCaption(asset.id, platform, { body: "", status: "generating" });
    try {
      const body = await generateCaption(
        asset.name,
        asset.type,
        platform as Platform
      );
      await supabase.from("captions").upsert(
        { asset_id: asset.id, platform, body, status: "ready" },
        { onConflict: "asset_id,platform" }
      );
      setCaption(asset.id, platform, { body, status: "ready" });
    } catch {
      setCaption(asset.id, platform, { status: "error" });
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const totalCount = selectedAssets.length * selectedPlatforms.length;
  const readyCount = Object.values(captions).filter(
    (c) => c.status === "ready"
  ).length;

  function assetAllReady(assetId: string) {
    return selectedPlatforms.every(
      (p) => captions[ck(assetId, p)]?.status === "ready"
    );
  }

  function assetStatus(assetId: string): CaptionStatus {
    const statuses = selectedPlatforms.map(
      (p) => captions[ck(assetId, p)]?.status ?? "pending"
    );
    if (statuses.every((s) => s === "ready")) return "ready";
    if (statuses.some((s) => s === "generating")) return "generating";
    if (statuses.some((s) => s === "error")) return "error";
    return "pending";
  }

  function dotColor(assetId: string, platform: string) {
    const s = captions[ck(assetId, platform)]?.status;
    if (s === "ready") {
      return PLATFORM_META[platform as Platform]?.dotColor ?? "bg-white/30";
    }
    return "bg-white/10";
  }

  const previewEnabled = selectedAssets.some((a) => assetAllReady(a.id));

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!selectedAssets.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground font-satoshi mb-4">
            No assets selected. Go to Library and pick some assets first.
          </p>
          <button
            onClick={() => navigate("/library")}
            className="glass-accent rounded-full px-5 py-2 text-body font-medium text-white"
          >
            Go to Library
          </button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* ── Left Panel — Asset Queue ──────────────────────────────────── */}
      <div className="w-[300px] shrink-0 glass-panel border-r-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <button
            onClick={() => navigate("/library")}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground glass-button transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="font-clash text-section font-bold text-foreground">
            Processing
          </h2>
        </div>

        <div className="flex-1 overflow-auto px-3 pb-3 space-y-1">
          {selectedAssets.map((asset) => {
            const status = assetStatus(asset.id);
            return (
              <div
                key={asset.id}
                className="flex items-center gap-3 rounded-xl p-3 bg-white/[0.03]"
              >
                {/* Thumbnail */}
                <div className="h-[52px] w-[52px] rounded-lg card-elevated shrink-0 overflow-hidden flex items-center justify-center">
                  {asset.previewUrl ? (
                    <img
                      src={asset.previewUrl}
                      alt={asset.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
                  )}
                </div>

                {/* Name + dots */}
                <div className="flex-1 min-w-0">
                  <p className="text-body font-satoshi text-foreground truncate text-sm">
                    {asset.name}
                  </p>
                  <div className="flex items-center gap-1 mt-1.5">
                    {selectedPlatforms.map((p) => (
                      <span
                        key={p}
                        className={`h-2 w-2 rounded-full transition-colors ${dotColor(asset.id, p)}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Status icon */}
                <div className="shrink-0">
                  {status === "ready" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : status === "generating" ? (
                    <Sparkles className="h-4 w-4 text-warning animate-pulse" />
                  ) : status === "error" ? (
                    <span className="h-2 w-2 rounded-full bg-destructive block" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/20 block" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.08] px-5 py-3">
          <span className="font-mono text-micro text-muted-foreground">
            {selectedAssets.length} assets · {selectedPlatforms.length}{" "}
            platforms · {readyCount}/{totalCount} captions
          </span>
        </div>
      </div>

      {/* ── Right Panel — Caption Review ──────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] sticky top-0 bg-background/80 backdrop-blur-sm z-10">
          <span className="font-mono text-body text-muted-foreground">
            {readyCount} / {totalCount} ready
          </span>
          <button
            onClick={() => navigate("/preview")}
            disabled={!previewEnabled}
            className={`rounded-full px-5 py-2 text-body font-medium transition-all flex items-center gap-2 ${
              previewEnabled
                ? "glass-accent text-white"
                : "glass-button text-muted-foreground cursor-not-allowed opacity-50"
            }`}
          >
            Preview Selected <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Platform accordion sections */}
        <div className="p-6 flex flex-col gap-6">
          {selectedPlatforms.map((platform) => {
            const meta = PLATFORM_META[platform as Platform];
            const isExpanded = expandedPlatforms.includes(platform);
            const readyForPlatform = selectedAssets.filter(
              (a) => captions[ck(a.id, platform)]?.status === "ready"
            ).length;

            return (
              <div key={platform}>
                {/* Platform header toggle */}
                <button
                  onClick={() =>
                    setExpandedPlatforms((prev) =>
                      prev.includes(platform)
                        ? prev.filter((p) => p !== platform)
                        : [...prev, platform]
                    )
                  }
                  className="flex items-center gap-2 mb-3 w-full group"
                >
                  <span
                    className={`h-3 w-3 rounded-full ${
                      meta?.dotColor ?? "bg-muted-foreground/30"
                    }`}
                  />
                  <span
                    className={`text-sub font-satoshi font-bold ${
                      meta?.textColor ?? "text-foreground"
                    }`}
                  >
                    {meta?.label ?? platform}
                  </span>
                  <span className="font-mono text-micro text-muted-foreground ml-1">
                    {readyForPlatform}/{selectedAssets.length} ready
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${
                      isExpanded ? "" : "-rotate-90"
                    }`}
                  />
                </button>

                {/* Asset caption cards */}
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex flex-col gap-2 overflow-hidden"
                  >
                    {selectedAssets.map((asset) => {
                      const key = ck(asset.id, platform);
                      const entry = captions[key];
                      const status = entry?.status ?? "pending";
                      const isEditing = editingKey === key;
                      const charLimit = meta?.charLimit ?? 280;

                      return (
                        <div
                          key={asset.id}
                          className="card-surface rounded-xl p-4 flex gap-4"
                        >
                          {/* Asset thumbnail */}
                          <div className="h-20 w-20 rounded-lg card-elevated flex items-center justify-center shrink-0 overflow-hidden">
                            {asset.previewUrl ? (
                              <img
                                src={asset.previewUrl}
                                alt={asset.name}
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            ) : (
                              <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                            )}
                          </div>

                          {/* Caption body */}
                          <div className="flex-1 min-w-0">
                            {status === "pending" || status === "generating" ? (
                              <div className="space-y-2 pt-1">
                                <div className="h-3 rounded-full glass-button overflow-hidden">
                                  <div className="h-full w-1/2 bg-accent-violet/30 animate-pulse rounded-full" />
                                </div>
                                <div className="h-3 w-4/5 rounded-full glass-button overflow-hidden">
                                  <div className="h-full w-1/2 bg-accent-violet/20 animate-pulse rounded-full" />
                                </div>
                                <div className="h-3 w-3/5 rounded-full glass-button overflow-hidden">
                                  <div className="h-full w-1/3 bg-accent-violet/10 animate-pulse rounded-full" />
                                </div>
                              </div>
                            ) : status === "error" ? (
                              <div className="pt-1">
                                <p className="text-body text-destructive font-satoshi">
                                  Failed to generate — click ↻ to retry.
                                </p>
                                {entry?.errorMsg && (
                                  <p className="text-micro text-destructive/70 font-mono mt-1 break-all">
                                    {entry.errorMsg}
                                  </p>
                                )}
                              </div>
                            ) : isEditing ? (
                              <textarea
                                autoFocus
                                value={editDraft}
                                rows={3}
                                onChange={(e) =>
                                  handleEditChange(
                                    key,
                                    asset.id,
                                    platform,
                                    e.target.value
                                  )
                                }
                                onBlur={() => commitEdit(asset.id, platform)}
                                className="w-full bg-transparent rounded-lg p-2 text-body text-foreground font-satoshi resize-none outline-none border border-accent-violet/40 focus:border-accent-violet"
                              />
                            ) : (
                              <p
                                className="text-body text-foreground font-satoshi leading-relaxed cursor-text pt-1"
                                onClick={() => {
                                  setEditingKey(key);
                                  setEditDraft(entry?.body ?? "");
                                }}
                              >
                                {entry?.body}
                              </p>
                            )}

                            {status === "ready" && !isEditing && (
                              <div className="mt-2 flex items-center justify-between">
                                <span className="rounded-md bg-success/10 px-2 py-0.5 text-micro font-mono text-success border border-success/20">
                                  {platform === "telegram_free" ||
                                  platform === "website"
                                    ? "CLEAN"
                                    : "EXPLICIT OK"}
                                </span>
                                <span
                                  className={`font-mono text-micro ${
                                    (entry?.body?.length ?? 0) > charLimit
                                      ? "text-destructive"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {entry?.body?.length ?? 0} / {charLimit}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              onClick={() => {
                                setEditingKey(key);
                                setEditDraft(entry?.body ?? "");
                              }}
                              disabled={status === "generating" || status === "pending"}
                              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors disabled:opacity-30"
                              title="Edit"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleRegenerate(asset, platform)}
                              disabled={status === "generating" || status === "pending"}
                              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors disabled:opacity-30"
                              title="Regenerate"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Export wrapped in error boundary ─────────────────────────────────────────

export default function ProcessingHub() {
  return (
    <ErrorBoundary>
      <ProcessingHubInner />
    </ErrorBoundary>
  );
}
