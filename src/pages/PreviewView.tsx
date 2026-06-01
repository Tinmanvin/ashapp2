import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
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
import { useSchedulerStore } from "@/store/schedulerStore";
import { supabase } from "@/lib/supabase";
import type { UploadedAsset } from "@/hooks/useFileUpload";

// ── Constants ──────────────────────────────────────────────────────────────────

const platformTabs = [
  { name: "X",        color: "border-platform-x",        bg: "bg-platform-x/10"        },
  { name: "Telegram", color: "border-platform-telegram", bg: "bg-platform-telegram/10" },
  { name: "Website",  color: "border-platform-website",  bg: "bg-platform-website/10"  },
];

const TAB_TO_PLATFORM_IDS: Record<string, string[]> = {
  X:        ["x"],
  Telegram: ["telegram_free", "telegram_vip", "telegram_test"],
  Website:  ["website"],
};

const TELEGRAM_REACTIONS = ["👍 42", "❤️ 128", "🔥 18"];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Full-res for images; thumbnail poster for videos (can't play in <img>)
function fullResSrc(asset: UploadedAsset): string {
  if (asset.type !== "IMAGE") return asset.previewUrl;
  const full = asset.previewUrl.replace("/thumbs/", "/files/").replace(/\.jpg$/, "");
  return full || asset.previewUrl;
}

const MEDIA_RADIUS: React.CSSProperties = {
  borderTopLeftRadius: "1rem",
  borderTopRightRadius: "1rem",
};

// ── Liquid glass play button — video assets only ───────────────────────────────

function VideoPlayOverlay({ isVideo, children }: { isVideo: boolean; children: React.ReactNode }) {
  if (!isVideo) return <>{children}</>;
  return (
    <div style={{ display: "grid" }} className="group/video">
      <div style={{ gridArea: "1 / 1" }}>{children}</div>
      <div
        style={{ gridArea: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
        className="opacity-0 scale-75 group-hover/video:opacity-100 group-hover/video:scale-100 transition-[opacity,transform] duration-[180ms] ease-out"
      >
        <div
          style={{
            width: 48, height: 48, borderRadius: "50%",
            backdropFilter: "blur(16px) saturate(2)", WebkitBackdropFilter: "blur(16px) saturate(2)",
            background: "rgba(255, 255, 255, 0.18)", border: "1.5px solid rgba(255, 255, 255, 0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ marginLeft: 3, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: "14px solid rgba(255,255,255,0.92)" }} />
        </div>
      </div>
    </div>
  );
}

// ── Single media block (used when a post has exactly one asset) ─────────────────

function MediaBlock({ asset, platform = "telegram" }: { asset: UploadedAsset; platform?: "x" | "telegram" }) {
  const src = fullResSrc(asset);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  if (platform === "telegram") {
    if (!src || failed) return <div style={{ width: "100%", aspectRatio: "4/3", backgroundColor: "#1d2733", ...MEDIA_RADIUS }} />;
    return <img src={src} alt="" style={{ display: "block", width: "100%", height: "auto", ...MEDIA_RADIUS }} onError={() => setFailed(true)} />;
  }

  if (asset.ratio === "portrait") {
    if (!src || failed) return <div style={{ width: "100%", aspectRatio: "3/4", backgroundColor: "#1d2733", borderRadius: "1rem" }} />;
    return <img src={src} alt={asset.name} style={{ display: "block", width: "auto", maxWidth: "100%", height: "auto", maxHeight: "50vh", ...MEDIA_RADIUS }} onError={() => setFailed(true)} />;
  }

  const cls = asset.ratio === "landscape" ? "w-full aspect-video" : "w-full aspect-square";
  return (
    <div className={cls}>
      {src && !failed ? (
        <img src={src} alt={asset.name} className="w-full h-full object-cover block" style={MEDIA_RADIUS} onError={() => setFailed(true)} />
      ) : (
        <div className="w-full h-full bg-[#1d2733]" style={MEDIA_RADIUS} />
      )}
    </div>
  );
}

// ── Album grid (2+ assets) — approximates native album/mosaic layouts ───────────

function GridTile({ asset }: { asset: UploadedAsset }) {
  const [failed, setFailed] = useState(false);
  const src = asset.previewUrl || fullResSrc(asset);
  return (
    <VideoPlayOverlay isVideo={asset.type === "VIDEO" || asset.type === "CLIP"}>
      <div className="w-full h-full bg-[#1d2733]">
        {src && !failed && (
          <img src={src} alt={asset.name} className="w-full h-full object-cover block" onError={() => setFailed(true)} />
        )}
      </div>
    </VideoPlayOverlay>
  );
}

/**
 * Approximates the native album mosaic used by Telegram (and X):
 *   2 → side by side · 3 → 1 tall left + 2 stacked right · 4 → 2x2
 *   5 → 2 on top + 3 on bottom · 6+ → rows of 3
 */
function AlbumGrid({ assets, platform }: { assets: UploadedAsset[]; platform: "x" | "telegram" }) {
  const n = assets.length;
  const radius = platform === "telegram" ? MEDIA_RADIUS : { borderRadius: "1rem" } as React.CSSProperties;
  const gap = 2;
  const cell: React.CSSProperties = { overflow: "hidden", aspectRatio: "1 / 1" };

  // 2 — side by side, tall tiles (matches Telegram's 2-up)
  if (n === 2) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap, overflow: "hidden", ...radius }}>
        {assets.map((a) => <div key={a.id} style={{ overflow: "hidden", aspectRatio: "4 / 5" }}><GridTile asset={a} /></div>)}
      </div>
    );
  }

  // 3 — 1 tall left + 2 stacked right
  if (n === 3) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gridTemplateRows: "1fr 1fr", gap, aspectRatio: "1 / 1", overflow: "hidden", ...radius }}>
        <div style={{ gridRow: "1 / 3", overflow: "hidden" }}><GridTile asset={assets[0]} /></div>
        <div style={{ overflow: "hidden" }}><GridTile asset={assets[1]} /></div>
        <div style={{ overflow: "hidden" }}><GridTile asset={assets[2]} /></div>
      </div>
    );
  }

  // 4 — 2x2
  if (n === 4) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap, overflow: "hidden", ...radius }}>
        {assets.map((a) => <div key={a.id} style={cell}><GridTile asset={a} /></div>)}
      </div>
    );
  }

  // 5 — 2 on top, 3 on bottom
  if (n === 5) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap, overflow: "hidden", ...radius }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>
          {assets.slice(0, 2).map((a) => <div key={a.id} style={{ overflow: "hidden", aspectRatio: "5 / 4" }}><GridTile asset={a} /></div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap }}>
          {assets.slice(2, 5).map((a) => <div key={a.id} style={cell}><GridTile asset={a} /></div>)}
        </div>
      </div>
    );
  }

  // 6+ — rows of 3
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap, overflow: "hidden", ...radius }}>
      {assets.map((a) => <div key={a.id} style={cell}><GridTile asset={a} /></div>)}
    </div>
  );
}

function TelegramBg() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ backgroundImage: "url('/telegram-bg.png')", backgroundSize: "cover", backgroundPosition: "center" }}
    />
  );
}

// ── X / Twitter post ────────────────────────────────────────────────────────────

function XPost({ assets, caption }: { assets: UploadedAsset[]; caption: string }) {
  const isGroup = assets.length > 1;
  const cover = assets[0];
  return (
    <div
      className={`mx-auto border border-[#2f3336] rounded-2xl px-4 py-4 ${!isGroup && cover.ratio !== "landscape" ? "max-w-[440px]" : "max-w-[598px]"}`}
      style={{ backgroundColor: "#000", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}
    >
      <div className="flex gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white select-none" style={{ background: "linear-gradient(135deg, #1d9bf0, #0d7ab5)" }}>A</div>
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
            {isGroup ? (
              <AlbumGrid assets={assets} platform="x" />
            ) : (
              <VideoPlayOverlay isVideo={cover.type === "VIDEO" || cover.type === "CLIP"}>
                <MediaBlock asset={cover} platform="x" />
              </VideoPlayOverlay>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-[#536471]">
            <span className="flex items-center gap-1.5 text-[13px]"><MessageCircle className="h-[18px] w-[18px]" /><span>42</span></span>
            <span className="flex items-center gap-1.5 text-[13px]"><Repeat2 className="h-[18px] w-[18px]" /><span>128</span></span>
            <span className="flex items-center gap-1.5 text-[13px]"><Heart className="h-[18px] w-[18px]" /><span>1.2K</span></span>
            <span className="flex items-center gap-1.5 text-[13px]"><BarChart2 className="h-[18px] w-[18px]" /><span>24K</span></span>
            <span className="flex items-center gap-1.5 text-[13px]"><Bookmark className="h-[18px] w-[18px]" /></span>
            <span className="flex items-center gap-1.5 text-[13px]"><Share2 className="h-[18px] w-[18px]" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Telegram post ────────────────────────────────────────────────────────────────

function TelegramPost({ assets, caption }: { assets: UploadedAsset[]; caption: string }) {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isGroup = assets.length > 1;

  return (
    <div className="mx-auto rounded-2xl overflow-hidden" style={{ background: "linear-gradient(to right, #342234, #222434)", width: "320px", maxWidth: "calc(100% - 2rem)" }}>
      <div style={{ borderRadius: "1rem 1rem 0 0", overflow: "hidden", transform: "translateZ(0)" }}>
        {isGroup ? (
          <AlbumGrid assets={assets} platform="telegram" />
        ) : (
          <VideoPlayOverlay isVideo={assets[0].type === "VIDEO" || assets[0].type === "CLIP"}>
            <MediaBlock asset={assets[0]} />
          </VideoPlayOverlay>
        )}
      </div>
      <div className="px-3 pt-2">
        {caption ? (
          <p className="text-[14px] leading-relaxed text-white whitespace-pre-wrap break-words">{caption}</p>
        ) : (
          <p className="text-[13px] italic" style={{ color: "rgba(255,255,255,0.35)" }}>No caption generated yet.</p>
        )}
      </div>
      <div className="flex items-center justify-between px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-1.5">
          {TELEGRAM_REACTIONS.map((r) => (
            <div key={r} className="rounded-full px-2 py-0.5 text-[12px] text-white select-none" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>{r}</div>
          ))}
        </div>
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.38)" }}>{now}</span>
      </div>
    </div>
  );
}

// ── Website preview (cover asset — website is a single-item funnel) ─────────────

function WebsitePreview({ asset, caption }: { asset: UploadedAsset; caption: string }) {
  const src = fullResSrc(asset);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const isPortrait = asset.ratio === "portrait";

  return (
    <div className="card-surface rounded-2xl overflow-hidden w-[80%] mx-auto">
      {isPortrait ? (
        <div className="flex items-center justify-center bg-black">
          {src && !failed ? (
            <img src={src} alt={asset.name} style={{ display: "block", width: "auto", maxWidth: "100%", height: "auto", maxHeight: "65vh" }} onError={() => setFailed(true)} />
          ) : (
            <div style={{ width: "100%", aspectRatio: "9/16", backgroundColor: "#111" }} />
          )}
        </div>
      ) : (
        <div className="w-full aspect-video bg-black">
          {src && !failed ? (
            <img src={src} alt={asset.name} className="w-full h-full object-cover block" onError={() => setFailed(true)} />
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: "#111" }} />
          )}
        </div>
      )}
      <div className="p-5">
        <p className="text-sub text-foreground font-satoshi whitespace-pre-wrap break-words">{caption || "No caption generated yet."}</p>
        <div className="mt-3 flex items-center gap-2 text-micro text-muted-foreground font-mono">
          <span>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
// A pipeline run is ONE post (a group of N). We preview the whole group per
// platform and approve it as a single unit.

export default function PreviewView() {
  const navigate = useNavigate();
  const { selectedAssets, selectedPlatforms, websiteConfig } = useProcessingStore();
  const { mergeApprovedQueue } = useSchedulerStore();

  const cover = selectedAssets[0] as UploadedAsset | undefined;
  const isGroup = selectedAssets.length > 1;

  const selectedTabNames = new Set(
    platformTabs.filter((p) => selectedPlatforms.some((sp) => TAB_TO_PLATFORM_IDS[p.name]?.includes(sp))).map((p) => p.name)
  );
  const firstSelectedTab = platformTabs.find((p) => selectedTabNames.has(p.name))?.name ?? "X";

  const [activePlatform, setActivePlatform] = useState(firstSelectedTab);
  const [approved, setApproved]             = useState(false);
  // Captions keyed by platform id — the group caption lives under the cover asset.
  const [captions, setCaptions]             = useState<Record<string, string>>({});

  // Load the group's captions (stored under the cover asset's id) once.
  useEffect(() => {
    if (!cover) return;
    supabase
      .from("captions")
      .select("platform, body")
      .eq("asset_id", cover.id)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((r) => { map[r.platform] = r.body; });
        setCaptions(map);
      });
  }, [cover]);

  // Hotkeys: ↑/↓ switch platform · A approve
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActivePlatform((cur) => {
          const idx = platformTabs.findIndex((p) => p.name === cur);
          return platformTabs[Math.min(platformTabs.length - 1, idx + 1)].name;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActivePlatform((cur) => {
          const idx = platformTabs.findIndex((p) => p.name === cur);
          return platformTabs[Math.max(0, idx - 1)].name;
        });
      } else if (e.key === "a" || e.key === "A") {
        setApproved((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Caption for the active tab: first selected platform id that has a caption.
  const platformIds  = TAB_TO_PLATFORM_IDS[activePlatform] ?? ["x"];
  const activeId      = platformIds.find((id) => selectedPlatforms.includes(id)) ?? platformIds[0];
  const currentCaption = captions[activeId] ?? "";

  const centerBg = activePlatform === "X" ? "#000000" : activePlatform === "Telegram" ? "#0d0e18" : undefined;

  function renderPreview() {
    if (!cover) {
      return (
        <div className="flex flex-col items-center justify-center gap-3">
          <p className="text-body text-muted-foreground">No assets selected.</p>
          <button onClick={() => navigate("/library")} className="glass-button rounded-full px-4 py-2 text-body text-foreground">Go to Library</button>
        </div>
      );
    }
    if (!selectedTabNames.has(activePlatform)) {
      const label = `${activePlatform} not selected for this post`;
      const empty = { ...cover, previewUrl: "", fileUrl: "" };
      const card = activePlatform === "X" ? <XPost assets={[empty]} caption={label} />
                 : activePlatform === "Telegram" ? <TelegramPost assets={[empty]} caption={label} />
                 : <WebsitePreview asset={empty} caption={label} />;
      return <div className="flex items-center justify-center min-h-[70vh]">{card}</div>;
    }
    if (activePlatform === "X")        return <XPost assets={selectedAssets} caption={currentCaption} />;
    if (activePlatform === "Telegram") return <TelegramPost assets={selectedAssets} caption={currentCaption} />;
    return <WebsitePreview asset={cover} caption={currentCaption} />;
  }

  return (
    <div className="flex h-full">
      {/* Left tab strip */}
      <div className="w-20 shrink-0 glass-panel border-r-0 flex flex-col items-center py-6 gap-3">
        {platformTabs.map((p) => (
          <button
            key={p.name}
            onClick={() => setActivePlatform(p.name)}
            className={`h-12 w-12 rounded-full flex items-center justify-center text-micro font-bold transition-all ${
              activePlatform === p.name ? `${p.bg} border-2 ${p.color} glow-ring` : "glass-button text-muted-foreground hover:text-foreground"
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
          <button onClick={() => navigate("/processing")} className="flex items-center gap-1 text-body text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Processing
          </button>

          <span className="font-mono text-body text-muted-foreground">
            {isGroup ? `${selectedAssets.length}-item group` : "Single post"}
          </span>

          <button
            onClick={() => setApproved((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-body font-medium transition-all ${
              approved ? "bg-success/20 text-success border border-success/30" : "glass-button text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {approved ? "Approved" : "Approve"}
          </button>
        </div>

        {/* Preview area */}
        <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: centerBg, transition: "background-color 0.4s ease" }}>
          <AnimatePresence>
            {activePlatform === "Telegram" && (
              <motion.div key="tg-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="absolute inset-0">
                <TelegramBg />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative h-full flex flex-col items-center py-8 px-4 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePlatform}
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
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[11px]">A</kbd> to approve · <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 text-[11px]">↑↓</kbd> to switch platform
          </span>
          <button
            onClick={() => {
              if (!approved || !selectedAssets.length) return;
              const item = {
                groupId: crypto.randomUUID(),
                assets: selectedAssets,
                platforms: selectedPlatforms,
                captions: Object.fromEntries(selectedPlatforms.map((p) => [p, captions[p] ?? ""])),
                ...(websiteConfig ? { websiteConfig } : {}),
              };
              mergeApprovedQueue([item]);
              navigate("/scheduler");
            }}
            disabled={!approved}
            className={`rounded-full px-5 py-2.5 text-body font-medium transition-all flex items-center gap-2 ${
              approved ? "glass-accent text-white" : "glass-button text-white/35 cursor-not-allowed"
            }`}
          >
            Schedule Post <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
