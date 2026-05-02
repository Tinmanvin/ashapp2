import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  MessageCircle,
  Repeat2,
  Heart,
  Bookmark,
  BarChart2,
  Share2,
  ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProcessingStore } from "@/store/processingStore";
import { supabase } from "@/lib/supabase";
import type { UploadedAsset } from "@/hooks/useFileUpload";

// ── Constants ──────────────────────────────────────────────────────────────────

const platformTabs = [
  { name: "X",        color: "border-platform-x",        bg: "bg-platform-x/10"        },
  { name: "Reddit",   color: "border-platform-reddit",   bg: "bg-platform-reddit/10"   },
  { name: "Telegram", color: "border-platform-telegram", bg: "bg-platform-telegram/10" },
  { name: "Website",  color: "border-platform-website",  bg: "bg-platform-website/10"  },
];

const TAB_TO_PLATFORM_ID: Record<string, string> = {
  X:        "x",
  Reddit:   "reddit",
  Telegram: "telegram_free",
  Website:  "website",
};

const TELEGRAM_REACTIONS = ["👍 42", "❤️ 128", "🔥 18"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ratioContainerCls(
  ratio: UploadedAsset["ratio"],
  platform: "x" | "telegram"
): string {
  if (ratio === "landscape") return "w-full aspect-video";
  if (ratio === "square")
    return platform === "x"
      ? "w-full aspect-square"
      : "w-full aspect-square max-h-[370px]";
  return platform === "x"
    ? "w-full aspect-[9/16] max-h-[520px]"
    : "w-full aspect-[9/16] max-h-[calc(100vh-308px)]";
}

const MEDIA_RADIUS: React.CSSProperties = {
  borderTopLeftRadius: "1rem",
  borderTopRightRadius: "1rem",
};

// ── Shared media block ────────────────────────────────────────────────────────

function MediaBlock({
  asset,
  platform = "telegram",
}: {
  asset: UploadedAsset;
  platform?: "x" | "telegram";
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [asset.previewUrl]);

  if (platform === "telegram") {
    if (!asset.previewUrl || failed) {
      return <div style={{ width: "100%", aspectRatio: "4/3", backgroundColor: "#1d2733", clipPath: "inset(0 round 1rem 1rem 0 0)" }} />;
    }

    return (
      <img
        src={asset.previewUrl}
        alt=""
        style={{ display: "block", width: "100%", height: "auto", ...MEDIA_RADIUS }}
        onError={() => setFailed(true)}
      />
    );
  }

  // X: original aspect-ratio + max-height approach with MEDIA_RADIUS on img
  const cls = ratioContainerCls(asset.ratio, "x");
  return (
    <div className={cls}>
      {asset.previewUrl && !failed ? (
        <img
          src={asset.previewUrl}
          alt={asset.name}
          className={`w-full h-full block ${asset.ratio === "portrait" ? "object-contain" : "object-cover"}`}
          style={MEDIA_RADIUS}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full h-full bg-[#1d2733]" style={MEDIA_RADIUS} />
      )}
    </div>
  );
}

function TelegramBg() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: "url('/telegram-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}

// ── X / Twitter post ──────────────────────────────────────────────────────────

function XPost({ asset, caption }: { asset: UploadedAsset; caption: string }) {
  return (
    <div
      className="mx-auto max-w-[598px] border border-[#2f3336] rounded-2xl px-4 py-4"
      style={{
        backgroundColor: "#000",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div
          className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white select-none"
          style={{ background: "linear-gradient(135deg, #1d9bf0, #0d7ab5)" }}
        >
          A
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-bold text-[15px] text-white">Ash</span>
            <span className="text-[15px] text-[#536471]">@AshBlackMagic</span>
          </div>

          {caption ? (
            <p className="mt-1 text-[15px] leading-relaxed text-white whitespace-pre-wrap break-words">{caption}</p>
          ) : (
            <p className="mt-1 text-[14px] text-[#536471] italic">No caption generated yet.</p>
          )}

          <div
            className={`mt-3 rounded-[16px] overflow-hidden${
              asset.ratio === "portrait"
                ? " max-w-[280px] mx-auto"
                : asset.ratio === "square"
                ? " max-w-[400px] mx-auto"
                : ""
            }`}
          >
            <MediaBlock asset={asset} platform="x" />
          </div>

          <div className="mt-3 flex items-center justify-between text-[#536471]">
            <span className="flex items-center gap-1.5 text-[13px] hover:text-[#1d9bf0] transition-colors cursor-pointer">
              <MessageCircle className="h-[18px] w-[18px]" /><span>42</span>
            </span>
            <span className="flex items-center gap-1.5 text-[13px] hover:text-[#00ba7c] transition-colors cursor-pointer">
              <Repeat2 className="h-[18px] w-[18px]" /><span>128</span>
            </span>
            <span className="flex items-center gap-1.5 text-[13px] hover:text-[#f91880] transition-colors cursor-pointer">
              <Heart className="h-[18px] w-[18px]" /><span>1.2K</span>
            </span>
            <span className="flex items-center gap-1.5 text-[13px] hover:text-[#1d9bf0] transition-colors cursor-pointer">
              <BarChart2 className="h-[18px] w-[18px]" /><span>24K</span>
            </span>
            <span className="flex items-center gap-1.5 text-[13px] hover:text-[#1d9bf0] transition-colors cursor-pointer">
              <Bookmark className="h-[18px] w-[18px]" />
            </span>
            <span className="flex items-center gap-1.5 text-[13px] hover:text-[#1d9bf0] transition-colors cursor-pointer">
              <Share2 className="h-[18px] w-[18px]" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Telegram post ─────────────────────────────────────────────────────────────

function TelegramPost({ asset, caption }: { asset: UploadedAsset; caption: string }) {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="mx-auto rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(to right, #342234, #222434)",
        width: "320px",
        maxWidth: "calc(100% - 2rem)",
      }}
    >
        {/* Image — GPU-composited wrapper so overflow:hidden clips promoted img layer */}
        <div style={{ borderRadius: "1rem 1rem 0 0", overflow: "hidden", transform: "translateZ(0)" }}>
          <MediaBlock asset={asset} />
        </div>

        {/* Caption */}
        <div className="px-3 pt-2">
          {caption ? (
            <p className="text-[14px] leading-relaxed text-white whitespace-pre-wrap break-words">{caption}</p>
          ) : (
            <p className="text-[13px] italic" style={{ color: "rgba(255,255,255,0.35)" }}>
              No caption generated yet.
            </p>
          )}
        </div>

        {/* Emoji reactions + timestamp — inside bubble at the bottom */}
        <div className="flex items-center justify-between px-3 pt-2 pb-2.5">
          <div className="flex items-center gap-1.5">
            {TELEGRAM_REACTIONS.map((r) => (
              <div
                key={r}
                className="rounded-full px-2 py-0.5 text-[12px] text-white cursor-pointer select-none"
                style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
              >
                {r}
              </div>
            ))}
          </div>
          <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.38)" }}>
            {now}
          </span>
        </div>
    </div>
  );
}

// ── Reddit preview (unchanged) ────────────────────────────────────────────────

function RedditPreview() {
  return (
    <div className="card-elevated rounded-2xl p-4 max-w-[520px] mx-auto">
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <ArrowUp className="h-5 w-5 text-platform-reddit" />
          <span className="text-body font-bold text-platform-reddit">1</span>
          <ArrowDown className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <span className="text-micro text-muted-foreground font-mono">r/ashtv · Posted by u/ash</span>
          <h3 className="text-sub font-bold text-foreground mt-1">
            Episode 47 behind the scenes — the craziest shoot we've done
          </h3>
          <div className="aspect-video rounded-lg card-elevated atmospheric-glow mt-3" />
          <div className="flex items-center gap-4 mt-3 text-muted-foreground text-micro">
            <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> 0 Comments</span>
            <span className="flex items-center gap-1"><Share2 className="h-3 w-3" /> Share</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Website preview (unchanged) ───────────────────────────────────────────────

function WebsitePreview() {
  return (
    <div className="card-surface rounded-2xl overflow-hidden max-w-[520px] mx-auto">
      <div className="aspect-video card-elevated atmospheric-glow" />
      <div className="p-5">
        <p className="text-sub text-foreground font-satoshi">
          Episode 47 is now live. This one pushes every boundary we've set. Watch the full episode on the site.
        </p>
        <div className="mt-3 flex items-center gap-2 text-micro text-muted-foreground font-mono">
          <span>Mar 29, 2026</span>
          <span>·</span>
          <span className="rounded-md glass-button px-2 py-0.5">Episode</span>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function PreviewView() {
  const navigate = useNavigate();
  const { selectedAssets } = useProcessingStore();

  const [activePlatform, setActivePlatform] = useState("X");
  const [currentIdx, setCurrentIdx]         = useState(0);
  const [approvedIds, setApprovedIds]       = useState<Set<string>>(new Set());
  const [captions, setCaptions]             = useState<Record<string, string>>({});

  const totalAssets  = selectedAssets.length;
  const currentAsset = selectedAssets[currentIdx] as UploadedAsset | undefined;
  const isApproved   = currentAsset ? approvedIds.has(currentAsset.id) : false;

  // Load all captions from Supabase once on mount
  useEffect(() => {
    if (!selectedAssets.length) return;
    const ids = selectedAssets.map((a) => a.id);
    supabase
      .from("captions")
      .select("asset_id, platform, body")
      .in("asset_id", ids)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((r) => { map[`${r.asset_id}:${r.platform}`] = r.body; });
        setCaptions(map);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hotkey: 'A' → approve current asset + advance to next
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "a" && e.key !== "A") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!currentAsset) return;
      setApprovedIds((prev) => {
        const next = new Set(prev);
        next.add(currentAsset.id);
        return next;
      });
      setCurrentIdx((i) => Math.min(totalAssets - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentAsset, totalAssets]);

  function toggleApprove() {
    if (!currentAsset) return;
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(currentAsset.id)) next.delete(currentAsset.id);
      else next.add(currentAsset.id);
      return next;
    });
  }

  const platformId     = TAB_TO_PLATFORM_ID[activePlatform] ?? "x";
  const captionKey     = currentAsset ? `${currentAsset.id}:${platformId}` : "";
  const currentCaption = captions[captionKey] ?? "";

  // Center area background per platform
  const centerBg = activePlatform === "X" ? "#000000"
                 : activePlatform === "Telegram" ? "#0d0e18"
                 : undefined;

  function renderPreview() {
    if (!currentAsset) {
      return (
        <div className="flex flex-col items-center justify-center gap-3">
          <p className="text-body text-muted-foreground">No assets selected.</p>
          <button
            onClick={() => navigate("/library")}
            className="glass-button rounded-full px-4 py-2 text-body text-foreground"
          >
            Go to Library
          </button>
        </div>
      );
    }
    if (activePlatform === "X")        return <XPost asset={currentAsset} caption={currentCaption} />;
    if (activePlatform === "Telegram") return <TelegramPost asset={currentAsset} caption={currentCaption} />;
    if (activePlatform === "Reddit")   return <RedditPreview />;
    return <WebsitePreview />;
  }

  return (
    <div className="flex h-full">
      {/* Left Icon Strip — unchanged */}
      <div className="w-20 shrink-0 glass-panel border-r-0 flex flex-col items-center py-6 gap-3">
        {platformTabs.map((p) => (
          <button
            key={p.name}
            onClick={() => setActivePlatform(p.name)}
            className={`h-12 w-12 rounded-full flex items-center justify-center text-micro font-bold transition-all ${
              activePlatform === p.name
                ? `${p.bg} border-2 ${p.color} glow-ring`
                : "glass-button text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.name[0]}
          </button>
        ))}
      </div>

      {/* Center */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
          <button
            onClick={() => navigate("/processing")}
            className="flex items-center gap-1 text-body text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Processing
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              disabled={currentIdx === 0}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground glass-button disabled:opacity-30"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-body text-muted-foreground">
              {totalAssets ? currentIdx + 1 : 0} / {totalAssets}
            </span>
            <button
              onClick={() => setCurrentIdx((i) => Math.min(totalAssets - 1, i + 1))}
              disabled={!totalAssets || currentIdx >= totalAssets - 1}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground glass-button disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={toggleApprove}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-body font-medium transition-all ${
              isApproved
                ? "bg-success/20 text-success border border-success/30"
                : "glass-button text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {isApproved ? "Approved" : "Approve"}
          </button>
        </div>

        {/* Preview area — bg transitions with platform */}
        <div
          className="flex-1 relative overflow-hidden"
          style={{
            backgroundColor: centerBg,
            transition: "background-color 0.4s ease",
          }}
        >
          {/* Telegram sketch wallpaper pattern */}
          <AnimatePresence>
            {activePlatform === "Telegram" && (
              <motion.div
                key="tg-bg"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0"
              >
                <TelegramBg />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Content */}
          <div className="relative h-full flex flex-col items-center py-8 px-4 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activePlatform}-${currentIdx}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="w-full"
              >
                {renderPreview()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.08] px-6 py-4 flex items-center justify-between">
          <span className="text-micro text-muted-foreground font-mono">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[11px]">A</kbd> to approve &amp; next
          </span>
          <button
            onClick={() => navigate("/scheduler")}
            className="rounded-full glass-accent px-5 py-2.5 text-body font-medium text-white transition-all flex items-center gap-2"
          >
            Schedule Approved <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
