import { Component, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Edit3,
  Sparkles,
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
import { MediaImg } from '@/components/MediaImg';

// ── Types ─────────────────────────────────────────────────────────────────────

type CaptionStatus = "pending" | "generating" | "ready" | "error";

interface CaptionEntry {
  body: string;
  status: CaptionStatus;
  errorMsg?: string;
}

// ── Error Boundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
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
// A pipeline run is ONE post (a "group of N"). We generate ONE caption per
// platform for the whole group, using the cover (first) asset for context.

function ProcessingHubInner() {
  const navigate = useNavigate();
  const { selectedAssets, selectedPlatforms } = useProcessingStore();

  const cover = selectedAssets[0];
  const isGroup = selectedAssets.length > 1;

  // Captions keyed by platform only — one per platform for the whole group.
  const [captions, setCaptions] = useState<Record<string, CaptionEntry>>({});
  const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const initialized = useRef(false);

  const setCaption = useCallback((platform: string, patch: Partial<CaptionEntry>) => {
    setCaptions((prev) => ({
      ...prev,
      [platform]: { body: "", status: "pending", ...prev[platform], ...patch },
    }));
  }, []);

  // Persist the group caption under the cover asset's id (reuses the captions table).
  const persist = useCallback(
    (platform: string, body: string) => {
      if (!cover) return;
      return supabase.from("captions").upsert(
        { asset_id: cover.id, platform, body, status: "ready" },
        { onConflict: "asset_id,platform" }
      );
    },
    [cover]
  );

  const loadOrGenerate = useCallback(
    async (platform: string) => {
      if (!cover) return;
      try {
        const { data } = await supabase
          .from("captions")
          .select("body")
          .eq("asset_id", cover.id)
          .eq("platform", platform)
          .maybeSingle();

        if (data?.body) {
          setCaption(platform, { body: data.body, status: "ready" });
          return;
        }

        setCaption(platform, { status: "generating" });
        const body = await generateCaption(cover.name, cover.type, platform as Platform);
        await persist(platform, body);
        setCaption(platform, { body, status: "ready" });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("Caption error", platform, err);
        setCaption(platform, { status: "error", errorMsg });
      }
    },
    [cover, persist, setCaption]
  );

  // On mount: init pending for each platform, then stagger generation.
  useEffect(() => {
    if (initialized.current || !selectedAssets.length || !selectedPlatforms.length) return;
    initialized.current = true;

    const initial: Record<string, CaptionEntry> = {};
    for (const platform of selectedPlatforms) initial[platform] = { body: "", status: "pending" };
    setCaptions(initial);

    selectedPlatforms.forEach((platform, i) => {
      setTimeout(() => loadOrGenerate(platform), i * 150);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { saveTimers.current.forEach((t) => clearTimeout(t)); }, []);

  function handleEditChange(platform: string, value: string) {
    setEditDraft(value);
    const existing = saveTimers.current.get(platform);
    if (existing) clearTimeout(existing);
    saveTimers.current.set(
      platform,
      setTimeout(() => {
        persist(platform, value)?.then(() => setCaption(platform, { body: value }));
      }, 800)
    );
  }

  function commitEdit(platform: string) {
    const existing = saveTimers.current.get(platform);
    if (existing) clearTimeout(existing);
    persist(platform, editDraft)?.then(() => setCaption(platform, { body: editDraft }));
    setEditingPlatform(null);
  }

  async function handleRegenerate(platform: string) {
    if (!cover) return;
    if (editingPlatform === platform) setEditingPlatform(null);
    setCaption(platform, { body: "", status: "generating" });
    try {
      const body = await generateCaption(cover.name, cover.type, platform as Platform);
      await persist(platform, body);
      setCaption(platform, { body, status: "ready" });
    } catch (err) {
      setCaption(platform, { status: "error", errorMsg: err instanceof Error ? err.message : String(err) });
    }
  }

  const readyCount = selectedPlatforms.filter((p) => captions[p]?.status === "ready").length;
  const previewEnabled = selectedPlatforms.length > 0 && selectedPlatforms.every((p) => captions[p]?.status === "ready");

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
      {/* ── Left Panel — the group ──────────────────────────────────────── */}
      <div className="w-[300px] shrink-0 glass-panel border-r-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <button
            onClick={() => navigate("/library")}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground glass-button transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="font-clash text-section font-bold text-foreground">Processing</h2>
        </div>

        <div className="px-5 pb-3">
          <p className="text-micro font-mono text-muted-foreground mb-2">
            {isGroup ? `${selectedAssets.length}-item group post` : "Single post"}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {selectedAssets.slice(0, 9).map((a, i) => (
              <div key={a.id} className="relative aspect-square rounded-lg overflow-hidden bg-white/5">
                {a.previewUrl ? (
                  <MediaImg src={a.previewUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                  </div>
                )}
                {i === 0 && isGroup && (
                  <span className="absolute top-0.5 left-0.5 rounded bg-accent-violet/80 px-1 text-[8px] font-bold text-white">
                    1st
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-white/[0.08] px-5 py-3">
          <span className="font-mono text-micro text-muted-foreground">
            {selectedAssets.length} {selectedAssets.length === 1 ? "asset" : "assets"} ·{" "}
            {readyCount}/{selectedPlatforms.length} captions
          </span>
        </div>
      </div>

      {/* ── Right Panel — one caption per platform ──────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] sticky top-0 bg-background/80 backdrop-blur-sm z-10">
          <span className="font-mono text-body text-muted-foreground">
            {readyCount} / {selectedPlatforms.length} captions ready
          </span>
          <button
            onClick={() => navigate("/preview")}
            disabled={!previewEnabled}
            className={`rounded-full px-5 py-2 text-body font-medium transition-all flex items-center gap-2 ${
              previewEnabled ? "glass-accent text-white" : "glass-button text-muted-foreground cursor-not-allowed opacity-50"
            }`}
          >
            Preview <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-3">
          {selectedPlatforms.map((platform) => {
            const meta = PLATFORM_META[platform as Platform];
            const entry = captions[platform];
            const status = entry?.status ?? "pending";
            const isEditing = editingPlatform === platform;
            const charLimit = meta?.charLimit ?? 280;

            return (
              <div key={platform} className="card-surface rounded-xl p-4">
                {/* Platform header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`h-3 w-3 rounded-full ${meta?.dotColor ?? "bg-muted-foreground/30"}`} />
                  <span className={`text-sub font-satoshi font-bold ${meta?.textColor ?? "text-foreground"}`}>
                    {meta?.label ?? platform}
                  </span>
                  {status === "ready" ? (
                    <Check className="h-4 w-4 text-success ml-auto" />
                  ) : status === "generating" ? (
                    <Sparkles className="h-4 w-4 text-warning animate-pulse ml-auto" />
                  ) : status === "error" ? (
                    <span className="h-2 w-2 rounded-full bg-destructive ml-auto" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/20 ml-auto" />
                  )}
                </div>

                <div className="flex gap-4">
                  {/* Cover thumbnail */}
                  <div className="relative h-20 w-20 rounded-lg card-elevated flex items-center justify-center shrink-0 overflow-hidden">
                    {cover?.previewUrl ? (
                      <MediaImg src={cover.previewUrl} alt={cover.name} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                    )}
                    {isGroup && (
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
                        {selectedAssets.length}
                      </span>
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
                      </div>
                    ) : status === "error" ? (
                      <div className="pt-1">
                        <p className="text-body text-destructive font-satoshi">Failed to generate — click ↻ to retry.</p>
                        {entry?.errorMsg && (
                          <p className="text-micro text-destructive/70 font-mono mt-1 break-all">{entry.errorMsg}</p>
                        )}
                      </div>
                    ) : isEditing ? (
                      <textarea
                        autoFocus
                        value={editDraft}
                        rows={3}
                        onChange={(e) => handleEditChange(platform, e.target.value)}
                        onBlur={() => commitEdit(platform)}
                        className="w-full bg-transparent rounded-lg p-2 text-body text-foreground font-satoshi resize-none outline-none border border-accent-violet/40 focus:border-accent-violet"
                      />
                    ) : (
                      <p
                        className="text-body text-foreground font-satoshi leading-relaxed cursor-text pt-1 whitespace-pre-wrap"
                        onClick={() => { setEditingPlatform(platform); setEditDraft(entry?.body ?? ""); }}
                      >
                        {entry?.body}
                      </p>
                    )}

                    {status === "ready" && !isEditing && (
                      <div className="mt-2 flex justify-end">
                        <span className={`font-mono text-micro ${(entry?.body?.length ?? 0) > charLimit ? "text-destructive" : "text-muted-foreground"}`}>
                          {entry?.body?.length ?? 0} / {charLimit}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingPlatform(platform); setEditDraft(entry?.body ?? ""); }}
                      disabled={status === "generating" || status === "pending"}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors disabled:opacity-30"
                      title="Edit"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleRegenerate(platform)}
                      disabled={status === "generating" || status === "pending"}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors disabled:opacity-30"
                      title="Regenerate"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ProcessingHub() {
  return (
    <ErrorBoundary>
      <ProcessingHubInner />
    </ErrorBoundary>
  );
}
