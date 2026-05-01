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

// Center area background per platform — gives the immersive "you're on the platform" feel
const PLATFORM_BG: Record<string, string> = {
  X:        "#000000",
  Telegram: "#0e1621",
};

// ── Shared helpers ─────────────────────────────────────────────────────────────

function ratioClass(ratio: UploadedAsset["ratio"]): string {
  if (ratio === "portrait") return "aspect-[9/16] max-h-[480px]";
  if (ratio === "square")   return "aspect-square";
  return "aspect-video"; // landscape default
}

function MediaBlock({ asset, className = "" }: { asset: UploadedAsset; className?: string }) {
  const rc = ratioClass(asset.ratio);
  return (
    <div className={`w-full overflow-hidden ${rc} ${className}`}>
      {asset.previewUrl ? (
        asset.type === "VIDEO" ? (
          <video
            src={asset.previewUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
          />
        ) : (
          <img
            src={asset.previewUrl}
            alt={asset.name}
            className="w-full h-full object-cover"
          />
        )
      ) : (
        <div className="w-full h-full bg-[#1d2733]" />
      )}
    </div>
  );
}

// ── X / Twitter mockup ────────────────────────────────────────────────────────

function XPost({ asset, caption }: { asset: UploadedAsset; caption: string }) {
  return (
    <div
      className="mx-auto max-w-[598px] border-b border-[#2f3336] px-4 py-4"
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
          {/* Name row */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-bold text-[15px] text-white">Ash</span>
            <span className="text-[15px] text-[#536471]">@AshBlackMagic</span>
          </div>

          {/* Caption */}
          {caption ? (
            <p className="mt-1 text-[15px] leading-relaxed text-white whitespace-pre-wrap break-words">
              {caption}
            </p>
          ) : (
            <p className="mt-1 text-[14px] text-[#536471] italic">No caption generated yet.</p>
          )}

          {/* Media — rounded corners, NOT borderless */}
          <div className="mt-3 rounded-[16px] overflow-hidden">
            <MediaBlock asset={asset} />
          </div>

          {/* Action bar */}
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

// ── Telegram channel post mockup ───────────────────────────────────────────────

const TELEGRAM_REACTIONS = ["👍 42", "❤️ 128", "🔥 18"];

function TelegramPost({
  asset,
  caption,
  platform,
}: {
  asset: UploadedAsset;
  caption: string;
  platform: string;
}) {
  const isVip = platform === "telegram_vip";
  const channelName = isVip ? "Black Magic 🔞" : "Black Magic Free 📱";
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto flex flex-col gap-2" style={{ maxWidth: "420px" }}>
      {/* Channel label */}
      <div className="text-xs font-medium text-[#8899aa] select-none">{channelName}</div>

      {/* Message bubble — media is BORDERLESS (no padding at top) */}
      <div
        className="w-full overflow-hidden rounded-2xl"
        style={{ backgroundColor: "#2b5278" }}
      >
        {/* Media fills the entire bubble width edge-to-edge */}
        <MediaBlock asset={asset} />

        {/* Caption + timestamp sit inside the bubble below the media */}
        <div className="px-3 pt-2 pb-2">
          {caption ? (
            <p className="text-[14px] leading-relaxed text-white whitespace-pre-wrap break-words">
              {caption}
            </p>
          ) : (
            <p className="text-[13px] text-[#7aa3c0] italic">No caption generated yet.</p>
          )}
          <div className="flex justify-end mt-1">
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              {now}
            </span>
          </div>
        </div>
      </div>

      {/* Emoji reactions below the bubble */}
      <div className="flex items-center gap-2">
        {TELEGRAM_REACTIONS.map((r) => (
          <div
            key={r}
            className="rounded-full px-2.5 py-0.5 text-[13px] text-white cursor-pointer"
            style={{ backgroundColor: "rgba(43,82,120,0.7)" }}
          >
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reddit preview (kept as-is) ────────────────────────────────────────────────

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
          <span className="text-micro text-muted-foreground font-mono">
            r/ashtv · Posted by u/ash
          </span>
          <h3 className="text-sub font-bold text-foreground mt-1">
            Episode 47 behind the scenes — the craziest shoot we've done
          </h3>
          <div className="aspect-video rounded-lg card-elevated atmospheric-glow mt-3" />
          <div className="flex items-center gap-4 mt-3 text-muted-foreground text-micro">
            <span className="flex items-center gap-1">
              <MessageCircle className="h-3 w-3" /> 0 Comments
            </span>
            <span className="flex items-center gap-1">
              <Share2 className="h-3 w-3" /> Share
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Website preview (kept as-is) ───────────────────────────────────────────────

function WebsitePreview() {
  return (
    <div className="card-surface rounded-2xl overflow-hidden max-w-[520px] mx-auto">
      <div className="aspect-video card-elevated atmospheric-glow" />
      <div className="p-5">
        <p className="text-sub text-foreground font-satoshi">
          Episode 47 is now live. This one pushes every boundary we've set. Watch the full
          episode on the site.
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
  const [approved, setApproved]             = useState(false);
  const [captions, setCaptions]             = useState<Record<string, string>>({});

  const totalAssets = selectedAssets.length;
  const currentAsset: UploadedAsset | undefined = selectedAssets[currentIdx];

  // Load all captions from Supabase once on mount (captions already generated in Processing step)
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

  const platformId    = TAB_TO_PLATFORM_ID[activePlatform] ?? "x";
  const captionKey    = currentAsset ? `${currentAsset.id}:${platformId}` : "";
  const currentCaption = captions[captionKey] ?? "";
  const centerBg      = PLATFORM_BG[activePlatform] ?? "transparent";

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
    if (activePlatform === "Telegram") return <TelegramPost asset={currentAsset} caption={currentCaption} platform={platformId} />;
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
            onClick={() => setApproved((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-body font-medium transition-all ${
              approved
                ? "bg-success/20 text-success border border-success/30"
                : "glass-button text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {approved ? "Approved" : "Approve"}
          </button>
        </div>

        {/* Preview area — background animates to match platform */}
        <motion.div
          animate={{ backgroundColor: centerBg }}
          transition={{ duration: 0.4 }}
          className="flex-1 flex items-center justify-center p-8 overflow-y-auto"
        >
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
        </motion.div>

        {/* Footer */}
        <div className="border-t border-white/[0.08] px-6 py-4 flex items-center justify-end">
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
