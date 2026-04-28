import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Edit3,
  Sparkles,
  ChevronDown,
  RotateCcw,
  Image as ImageIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProcessingStore } from "@/store/processingStore";
import { supabase } from "@/lib/supabase";
import { generateCaption } from "@/lib/openai";
import { PLATFORM_META, type Platform } from "@/lib/captionPrompts";
import type { UploadedAsset } from "@/hooks/useFileUpload";

type CaptionStatus = "pending" | "generating" | "ready" | "error";

interface CaptionEntry {
  body: string;
  status: CaptionStatus;
}

function captionKey(assetId: string, platform: string) {
  return `${assetId}:${platform}`;
}

export default function ProcessingHub() {
  const navigate = useNavigate();
  const { selectedAssets, selectedPlatforms } = useProcessingStore();

  const [captions, setCaptions] = useState<Record<string, CaptionEntry>>({});
  const [activeAssetId, setActiveAssetId] = useState<string | null>(
    selectedAssets[0]?.id ?? null
  );
  const [expandedPlatforms, setExpandedPlatforms] = useState<string[]>(
    selectedPlatforms.slice(0, 1)
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setCaption = useCallback(
    (assetId: string, platform: string, entry: Partial<CaptionEntry>) => {
      setCaptions((prev) => {
        const key = captionKey(assetId, platform);
        return { ...prev, [key]: { ...prev[key], ...entry } };
      });
    },
    []
  );

  const loadOrGenerate = useCallback(
    async (asset: UploadedAsset, platform: string) => {
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
        setCaption(asset.id, platform, { body: "", status: "error" });
      }
    },
    [setCaption]
  );

  useEffect(() => {
    if (!selectedAssets.length || !selectedPlatforms.length) return;

    const initial: Record<string, CaptionEntry> = {};
    for (const asset of selectedAssets) {
      for (const platform of selectedPlatforms) {
        initial[captionKey(asset.id, platform)] = {
          body: "",
          status: "pending",
        };
      }
    }
    setCaptions(initial);

    selectedAssets.forEach((asset, ai) => {
      selectedPlatforms.forEach((platform, pi) => {
        const delay = (ai * selectedPlatforms.length + pi) * 120;
        setTimeout(() => loadOrGenerate(asset, platform), delay);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedPlatforms.length) {
      setExpandedPlatforms([selectedPlatforms[0]]);
    }
  }, [selectedPlatforms]);

  const togglePlatform = (platform: string) => {
    setExpandedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  };

  const saveCaption = useCallback(
    async (assetId: string, platform: string, body: string) => {
      await supabase.from("captions").upsert(
        { asset_id: assetId, platform, body, status: "ready" },
        { onConflict: "asset_id,platform" }
      );
      setCaption(assetId, platform, { body, status: "ready" });
    },
    [setCaption]
  );

  const handleEditChange = (
    assetId: string,
    platform: string,
    value: string
  ) => {
    setEditDraft(value);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveCaption(assetId, platform, value);
    }, 800);
  };

  const handleEditBlur = (assetId: string, platform: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveCaption(assetId, platform, editDraft);
    setEditingKey(null);
  };

  const handleRegenerate = async (asset: UploadedAsset, platform: string) => {
    const key = captionKey(asset.id, platform);
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
      setCaption(asset.id, platform, { body: "", status: "error" });
    }
  };

  const totalCaptions = selectedAssets.length * selectedPlatforms.length;
  const readyCount = Object.values(captions).filter(
    (c) => c.status === "ready"
  ).length;

  const assetAllReady = (assetId: string) =>
    selectedPlatforms.every(
      (p) => captions[captionKey(assetId, p)]?.status === "ready"
    );

  const canPreview = selectedAssets.some((a) => assetAllReady(a.id));

  const activeAsset =
    selectedAssets.find((a) => a.id === activeAssetId) ?? selectedAssets[0];

  const platformDotColor = (assetId: string, platform: string) => {
    const entry = captions[captionKey(assetId, platform)];
    if (entry?.status === "ready")
      return (
        PLATFORM_META[platform as Platform]?.dotColor ?? "bg-muted-foreground/30"
      );
    return "bg-muted-foreground/20";
  };

  const assetStatus = (assetId: string): CaptionStatus => {
    const entries = selectedPlatforms.map(
      (p) => captions[captionKey(assetId, p)]?.status ?? "pending"
    );
    if (entries.every((s) => s === "ready")) return "ready";
    if (entries.some((s) => s === "generating")) return "generating";
    if (entries.some((s) => s === "error")) return "error";
    return "pending";
  };

  if (!selectedAssets.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground font-satoshi mb-4">
            No assets selected. Go to Library and select assets to process.
          </p>
          <button
            onClick={() => navigate("/library")}
            className="glass-button rounded-full px-5 py-2 text-body font-medium text-foreground"
          >
            Go to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Column — Asset Queue */}
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

        <div className="flex-1 overflow-auto px-3 pb-3">
          {selectedAssets.map((asset) => {
            const status = assetStatus(asset.id);
            const isActive = asset.id === activeAssetId;
            return (
              <button
                key={asset.id}
                onClick={() => setActiveAssetId(asset.id)}
                className={`w-full flex items-center gap-3 rounded-xl p-3 mb-1 transition-all text-left ${
                  isActive
                    ? "card-elevated border-l-[3px] border-accent-violet"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <div className="h-[56px] w-[56px] rounded-lg card-elevated flex items-center justify-center shrink-0 overflow-hidden">
                  {asset.previewUrl ? (
                    <img
                      src={asset.previewUrl}
                      alt={asset.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-body font-satoshi text-foreground truncate block text-sm">
                    {asset.name}
                  </span>
                  <div className="flex items-center gap-1 mt-1.5">
                    {selectedPlatforms.map((p) => (
                      <span
                        key={p}
                        className={`h-2 w-2 rounded-full transition-colors ${platformDotColor(asset.id, p)}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="shrink-0 ml-1">
                  {status === "ready" ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : status === "generating" ? (
                    <Sparkles className="h-4 w-4 text-warning animate-pulse" />
                  ) : status === "error" ? (
                    <span className="h-2 w-2 rounded-full bg-destructive block" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30 block" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-white/[0.08] px-5 py-3">
          <span className="font-mono text-micro text-muted-foreground">
            {selectedAssets.length} assets · {selectedPlatforms.length}{" "}
            platforms · {readyCount}/{totalCaptions} captions
          </span>
        </div>
      </div>

      {/* Right Panel — Caption Review */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            {activeAsset?.previewUrl && (
              <div className="h-9 w-9 rounded-lg overflow-hidden card-elevated shrink-0">
                <img
                  src={activeAsset.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <span className="font-satoshi text-body text-foreground truncate max-w-[260px]">
              {activeAsset?.name}
            </span>
          </div>
          <button
            onClick={() => navigate("/preview")}
            disabled={!canPreview}
            className={`rounded-full px-5 py-2 text-body font-medium transition-all flex items-center gap-2 ${
              canPreview
                ? "glass-accent text-white"
                : "glass-button text-muted-foreground cursor-not-allowed opacity-50"
            }`}
          >
            Preview Selected
          </button>
        </div>

        <div className="p-6 flex flex-col gap-3">
          {selectedPlatforms.map((platform) => {
            const meta = PLATFORM_META[platform as Platform];
            const isExpanded = expandedPlatforms.includes(platform);
            const key = captionKey(activeAsset?.id ?? "", platform);
            const entry = captions[key];
            const isEditing = editingKey === key;

            return (
              <div
                key={platform}
                className="card-surface rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => togglePlatform(platform)}
                  className="flex items-center gap-2 w-full px-4 py-3 hover:bg-white/[0.03] transition-colors"
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      meta?.dotColor ?? "bg-muted-foreground/30"
                    }`}
                  />
                  <span
                    className={`text-sub font-satoshi font-semibold ${
                      meta?.textColor ?? "text-foreground"
                    }`}
                  >
                    {meta?.label ?? platform}
                  </span>
                  {entry?.status === "ready" && (
                    <span className="ml-2 font-mono text-micro text-muted-foreground">
                      {entry.body.length} / {meta?.charLimit ?? 280}
                    </span>
                  )}
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${
                      isExpanded ? "" : "-rotate-90"
                    }`}
                  />
                </button>

                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="px-4 pb-4"
                  >
                    {!entry ||
                    entry.status === "pending" ||
                    entry.status === "generating" ? (
                      <div className="space-y-2 pt-1">
                        <div className="h-3 rounded-full glass-button overflow-hidden">
                          <div className="h-full w-1/2 bg-accent-violet/30 animate-pulse rounded-full" />
                        </div>
                        <div className="h-3 w-4/5 rounded-full glass-button overflow-hidden">
                          <div className="h-full w-1/2 bg-accent-violet/20 animate-pulse rounded-full" />
                        </div>
                        <div className="h-3 w-2/3 rounded-full glass-button overflow-hidden">
                          <div className="h-full w-1/3 bg-accent-violet/10 animate-pulse rounded-full" />
                        </div>
                      </div>
                    ) : entry.status === "error" ? (
                      <div className="flex items-center gap-3 pt-1">
                        <p className="flex-1 text-body text-destructive font-satoshi">
                          Failed to generate. Click regenerate to retry.
                        </p>
                        <button
                          onClick={() =>
                            activeAsset && handleRegenerate(activeAsset, platform)
                          }
                          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : isEditing ? (
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) =>
                          handleEditChange(
                            activeAsset!.id,
                            platform,
                            e.target.value
                          )
                        }
                        onBlur={() =>
                          handleEditBlur(activeAsset!.id, platform)
                        }
                        className="w-full bg-transparent text-body text-foreground font-satoshi leading-relaxed resize-none outline-none border border-white/[0.12] rounded-lg p-3 min-h-[80px]"
                      />
                    ) : (
                      <div className="flex gap-3 pt-1">
                        <p className="flex-1 text-body text-foreground font-satoshi leading-relaxed">
                          {entry.body}
                        </p>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            onClick={() => {
                              setEditingKey(key);
                              setEditDraft(entry.body);
                            }}
                            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors"
                            title="Edit caption"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              activeAsset &&
                              handleRegenerate(activeAsset, platform)
                            }
                            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground glass-button transition-colors"
                            title="Regenerate with AI"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {entry?.status === "ready" && !isEditing && (
                      <div className="mt-2">
                        <span className="rounded-md bg-success/10 px-2 py-0.5 text-micro font-mono text-success border border-success/20">
                          CLEAN
                        </span>
                      </div>
                    )}
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
