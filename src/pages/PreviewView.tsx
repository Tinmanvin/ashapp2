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

// X-only: maps detected ratio to the container class X actually uses in its feed.
// Portrait → 4:5 (X crops portrait in feed, not full 9:16).
// Landscape → 16:9. Square → 1:1.
function xRatioContainerCls(ratio: UploadedAsset["ratio"]): string {
  if (ratio === "landscape") return "w-full aspect-video";
  if (ratio === "square")    return "w-full aspect-square";
  return "w-full aspect-[4/5]"; // portrait: X crops to ~4:5 in the feed
}

// ── Shared media block ────────────────────────────────────────────────────────

function MediaBlock({
  asset,
  platform = "telegram",
}: {
  asset: UploadedAsset;
  platform?: "x" | "telegram";
}) {
  const [failed, setFailed] = useState(false);

  if (platform === "telegram") {
    // Natural height — no cropping. Telegram shows the full image at whatever
    // ratio it is. The parent bubble (overflow-hidden rounded-2xl) clips the
    // top corners. Preview area is overflow-y-auto so tall portraits still scroll.
    return (
      <div style={{ width: "100%" }}>
        {asset.previewUrl && !failed ? (
          <img
            src={asset.previewUrl}
            alt={asset.name}
            style={{ width: "100%", height: "auto", display: "block" }}
            onError={() => setFailed(true)}
          />
        ) : (
          <div style={{ width: "100%", aspectRatio: "4/3", backgroundColor: "#1d2733" }} />
        )}
      </div>
    );
  }

  // X: aspect-ratio container + object-cover to match X feed rendering
  const cls = xRatioContainerCls(asset.ratio);
  return (
    <div className={cls}>
      {asset.previewUrl && !failed ? (
        <img
          src={asset.previewUrl}
          alt={asset.name}
          className="w-full h-full object-cover block"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full h-full bg-[#1d2733]" />
      )}
    </div>
  );
}

// ── Telegram sketch background ─────────────────────────────────────────────────
// 600×600 tile, 22 doodles scattered at pseudo-random positions/rotations/scales
// stroke: medium indigo (#6862bb) at 0.32 opacity — matches real Telegram wallpaper

const S = "#6862bb"; // doodle stroke colour
const SW = "1.5";    // stroke width (inside each shape group)

function TelegramBg() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <svg width="100%" height="100%" style={{ opacity: 0.32 }}>
        <defs>
          <pattern id="tg-bg" x="0" y="0" width="600" height="600" patternUnits="userSpaceOnUse">

            {/* ── PANDA  tx:52 ty:42 rot:-15 sc:0.65 ── */}
            <g transform="translate(52,42) rotate(-15) scale(0.65)">
              <circle cx="0" cy="0" r="18" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="-12" cy="-13" r="6" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="12" cy="-13" r="6" fill="none" stroke={S} strokeWidth={SW}/>
              <ellipse cx="-7" cy="-3" rx="5" ry="6" fill="none" stroke={S} strokeWidth={SW}/>
              <ellipse cx="7" cy="-3" rx="5" ry="6" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="-7" cy="-3" r="2" fill={S}/>
              <circle cx="7" cy="-3" r="2" fill={S}/>
              <ellipse cx="0" cy="7" rx="3.5" ry="2" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── PINEAPPLE  tx:232 ty:25 rot:22 sc:0.68 ── */}
            <g transform="translate(232,25) rotate(22) scale(0.68)">
              <ellipse cx="0" cy="10" rx="13" ry="18" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M-8-6 Q-5-22 0-18 Q5-22 8-6" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="-11" y1="2" x2="11" y2="2" stroke={S} strokeWidth="1"/>
              <line x1="-12" y1="10" x2="12" y2="10" stroke={S} strokeWidth="1"/>
              <line x1="-10" y1="18" x2="10" y2="18" stroke={S} strokeWidth="1"/>
              <line x1="-4" y1="-6" x2="-5" y2="27" stroke={S} strokeWidth="1"/>
              <line x1="0" y1="-6" x2="0" y2="28" stroke={S} strokeWidth="1"/>
              <line x1="4" y1="-6" x2="5" y2="27" stroke={S} strokeWidth="1"/>
            </g>

            {/* ── ICE CREAM  tx:418 ty:54 rot:-8 sc:0.60 ── */}
            <g transform="translate(418,54) rotate(-8) scale(0.60)">
              <circle cx="0" cy="-12" r="13" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M-12 0 L-6 24 L6 24 L12 0" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="-3" y1="0" x2="0" y2="24" stroke={S} strokeWidth="1"/>
              <line x1="3" y1="0" x2="0" y2="24" stroke={S} strokeWidth="1"/>
              <path d="M0-25 Q5-30 0-33 Q-5-30 0-25" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── STAR  tx:556 ty:35 rot:30 sc:0.72 ── */}
            <g transform="translate(556,35) rotate(30) scale(0.72)">
              <path d="M0-22 L5-8 L21-8 L9 2 L13 18 L0 9 L-13 18 L-9 2 L-21-8 L-5-8 Z" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── PIZZA SLICE  tx:140 ty:150 rot:38 sc:0.65 ── */}
            <g transform="translate(140,150) rotate(38) scale(0.65)">
              <path d="M0-26 L-19 18 Q0 23 19 18 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M-13 12 Q0 16 13 12" fill="none" stroke={S} strokeWidth="1"/>
              <circle cx="-7" cy="2" r="2.5" fill={S}/>
              <circle cx="7" cy="7" r="2" fill={S}/>
              <circle cx="0" cy="-8" r="2" fill={S}/>
            </g>

            {/* ── HEART  tx:316 ty:132 rot:-22 sc:0.56 ── */}
            <g transform="translate(316,132) rotate(-22) scale(0.56)">
              <path d="M0 18 Q-22-4 -22-16 Q-22-30-11-30 Q-4-30 0-20 Q4-30 11-30 Q22-30 22-16 Q22-4 0 18 Z" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── FISH  tx:490 ty:160 rot:15 sc:0.72 ── */}
            <g transform="translate(490,160) rotate(15) scale(0.72)">
              <ellipse cx="-2" cy="0" rx="17" ry="10" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M15 0 L28-12 L28 12 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="-10" cy="-3" r="2" fill={S}/>
            </g>

            {/* ── DONUT  tx:28 ty:268 rot:20 sc:0.70 ── */}
            <g transform="translate(28,268) rotate(20) scale(0.70)">
              <circle cx="0" cy="0" r="18" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="0" r="8" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── BONE  tx:204 ty:255 rot:-38 sc:0.62 ── */}
            <g transform="translate(204,255) rotate(-38) scale(0.62)">
              <line x1="-18" y1="0" x2="18" y2="0" stroke={S} strokeWidth={SW}/>
              <circle cx="-22" cy="-4" r="5" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="-22" cy="4" r="5" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="22" cy="-4" r="5" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="22" cy="4" r="5" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── BIRD  tx:378 ty:270 rot:-10 sc:0.78 ── */}
            <g transform="translate(378,270) rotate(-10) scale(0.78)">
              <ellipse cx="0" cy="5" rx="10" ry="13" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="-11" r="8" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M8-11 L20-8 L16-5" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="-5" y1="18" x2="-7" y2="28" stroke={S} strokeWidth={SW}/>
              <line x1="5" y1="18" x2="3" y2="28" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── GIFT BOX  tx:546 ty:250 rot:28 sc:0.63 ── */}
            <g transform="translate(546,250) rotate(28) scale(0.63)">
              <rect x="-16" y="-12" width="32" height="26" rx="2" fill="none" stroke={S} strokeWidth={SW}/>
              <rect x="-16" y="-19" width="32" height="8" rx="2" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="0" y1="-19" x2="0" y2="14" stroke={S} strokeWidth={SW}/>
              <path d="M0-19 Q-8-30 -10-21 Q-12-13 0-13 Q12-13 10-21 Q8-30 0-19" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── ROCKET  tx:92 ty:382 rot:42 sc:0.68 ── */}
            <g transform="translate(92,382) rotate(42) scale(0.68)">
              <path d="M0-26 Q14 0 10 20 L0 16 L-10 20 Q-14 0 0-26 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M10 20 L18 32 L0 26 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M-10 20 L-18 32 L0 26 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="-4" r="5" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── FLOWER  tx:265 ty:378 rot:-18 sc:0.72 ── */}
            <g transform="translate(265,378) rotate(-18) scale(0.72)">
              <circle cx="0" cy="0" r="6" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="-15" r="7" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="13" cy="-7" r="7" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="13" cy="7" r="7" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="15" r="7" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="-13" cy="7" r="7" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="-13" cy="-7" r="7" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── AVOCADO  tx:432 ty:370 rot:25 sc:0.60 ── */}
            <g transform="translate(432,370) rotate(25) scale(0.60)">
              <path d="M0-26 Q22 0 16 18 Q8 32 0 32 Q-8 32 -16 18 Q-22 0 0-26 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="12" r="8" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── BELL  tx:578 ty:390 rot:-30 sc:0.65 ── */}
            <g transform="translate(578,390) rotate(-30) scale(0.65)">
              <path d="M0-20 Q-18-14 -18 5 L-18 15 L18 15 L18 5 Q18-14 0-20 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <path d="M-6 15 Q0 23 6 15" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="-22" r="3" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── CROWN  tx:55 ty:490 rot:-18 sc:0.70 ── */}
            <g transform="translate(55,490) rotate(-18) scale(0.70)">
              <path d="M-22 10 L-22-8 L-11 6 L0-16 L11 6 L22-8 L22 10 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="-22" y1="10" x2="22" y2="10" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="-16" r="3" fill={S}/>
              <circle cx="-22" cy="-8" r="2.5" fill={S}/>
              <circle cx="22" cy="-8" r="2.5" fill={S}/>
            </g>

            {/* ── LEAF  tx:218 ty:486 rot:45 sc:0.75 ── */}
            <g transform="translate(218,486) rotate(45) scale(0.75)">
              <path d="M0 22 Q-20-8 0-24 Q20-8 0 22 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="0" y1="-24" x2="0" y2="22" stroke={S} strokeWidth="1"/>
              <line x1="0" y1="-8" x2="-10" y2="2" stroke={S} strokeWidth="1"/>
              <line x1="0" y1="2" x2="10" y2="10" stroke={S} strokeWidth="1"/>
              <line x1="0" y1="10" x2="-8" y2="18" stroke={S} strokeWidth="1"/>
            </g>

            {/* ── BANANA  tx:388 ty:500 rot:-28 sc:0.66 ── */}
            <g transform="translate(388,500) rotate(-28) scale(0.66)">
              <path d="M-16-8 Q-22-22 -6-28 Q12-32 22-12 Q28 4 12 16 Q-2 22 -10 12 Q-16 4 -16-8 Z" fill="none" stroke={S} strokeWidth={SW}/>
              <line x1="-6" y1="-28" x2="-2" y2="-22" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── SPIRAL  tx:548 ty:486 rot:14 sc:0.70 ── */}
            <g transform="translate(548,486) rotate(14) scale(0.70)">
              <path d="M0 0 Q12 0 12-12 Q12-24 0-24 Q-24-24 -24 0 Q-24 24 0 26 Q26 26 28 0" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="0" r="3" fill="none" stroke={S} strokeWidth="1"/>
            </g>

            {/* ── SMALL STAR  tx:148 ty:568 rot:-10 sc:0.52 ── */}
            <g transform="translate(148,568) rotate(-10) scale(0.52)">
              <path d="M0-22 L5-8 L21-8 L9 2 L13 18 L0 9 L-13 18 L-9 2 L-21-8 L-5-8 Z" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── SMALL HEART  tx:312 ty:565 rot:25 sc:0.55 ── */}
            <g transform="translate(312,565) rotate(25) scale(0.55)">
              <path d="M0 18 Q-22-4 -22-16 Q-22-30-11-30 Q-4-30 0-20 Q4-30 11-30 Q22-30 22-16 Q22-4 0 18 Z" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── SMALL DONUT  tx:472 ty:572 rot:-5 sc:0.63 ── */}
            <g transform="translate(472,572) rotate(-5) scale(0.63)">
              <circle cx="0" cy="0" r="18" fill="none" stroke={S} strokeWidth={SW}/>
              <circle cx="0" cy="0" r="8" fill="none" stroke={S} strokeWidth={SW}/>
            </g>

            {/* ── DECORATIVE DOTS (scattered) ── */}
            <circle cx="168" cy="68" r="3" fill="none" stroke={S} strokeWidth="1.2"/>
            <circle cx="356" cy="48" r="2.5" fill={S}/>
            <circle cx="292" cy="198" r="2" fill={S}/>
            <circle cx="460" cy="292" r="3" fill="none" stroke={S} strokeWidth="1.2"/>
            <circle cx="178" cy="342" r="2.5" fill={S}/>
            <circle cx="512" cy="446" r="2" fill="none" stroke={S} strokeWidth="1.2"/>
            <circle cx="340" cy="452" r="2.5" fill={S}/>
            <circle cx="72" cy="148" r="2" fill={S}/>
            <circle cx="502" cy="88" r="2.5" fill="none" stroke={S} strokeWidth="1.2"/>

          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tg-bg)"/>
      </svg>
    </div>
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

          <div className="mt-3 rounded-[16px] overflow-hidden">
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
    <div className="mx-auto" style={{ maxWidth: "420px" }}>
      {/* Bubble — gradient matches real Telegram dark theme */}
      <div
        className="w-full overflow-hidden rounded-2xl"
        style={{ background: "linear-gradient(to right, #342234, #222434)" }}
      >
        {/* Media — borderless, flush to top of bubble */}
        <MediaBlock asset={asset} />

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
          <div className="relative h-full flex items-center justify-center p-8 overflow-y-auto">
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
