import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Sparkles, GripVertical,
  X, CheckCircle2, Circle, FileSpreadsheet, Send,
} from "lucide-react";
import { useSchedulerStore, type ScheduledAsset } from "@/store/schedulerStore";
import { PLATFORM_META } from "@/lib/captionPrompts";
import { postScheduledItems, type PostStage } from "@/lib/telegramPoster";
import { supabase } from "@/lib/supabase";
import TimePickerModal from "@/components/TimePickerModal";

// ── Platform display helpers ──────────────────────────────────────────────────

const PLATFORM_SHORT: Record<string, { letter: string; bg: string; text: string }> = {
  x:                 { letter: "X", bg: "bg-platform-x",       text: "text-black"  },
  reddit:            { letter: "R", bg: "bg-platform-reddit",  text: "text-white"  },
  telegram_free:     { letter: "T", bg: "bg-platform-telegram", text: "text-white" },
  telegram_free_vip: { letter: "F", bg: "bg-cyan-500",          text: "text-white" },
  telegram_vip:      { letter: "V", bg: "bg-blue-600",          text: "text-white" },
  website:           { letter: "W", bg: "bg-platform-website",  text: "text-white" },
};

function PlatformDots({ platforms }: { platforms: string[] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {platforms.map((p) => {
        const meta = PLATFORM_SHORT[p];
        if (!meta) return null;
        return (
          <span
            key={p}
            className={`h-4 w-4 rounded-full text-[9px] flex items-center justify-center font-bold ${meta.bg} ${meta.text}`}
          >
            {meta.letter}
          </span>
        );
      })}
    </div>
  );
}

// ── Sidebar draggable card ────────────────────────────────────────────────────

function QueueCard({
  item,
  onDragStart,
  selectionMode,
  selected,
  onToggle,
}: {
  item: ScheduledAsset;
  onDragStart: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const readyCount = item.platforms.filter(
    (p) => (item.captions[p] ?? "").trim().length > 0
  ).length;

  return (
    <motion.div
      draggable={!selectionMode}
      onDragStart={selectionMode ? undefined : onDragStart}
      onClick={selectionMode ? onToggle : undefined}
      whileHover={{ scale: 1.02 }}
      className={`card-surface rounded-xl p-3 mb-2 select-none transition-colors ${
        selectionMode
          ? "cursor-pointer " + (selected ? "ring-1 ring-accent-violet bg-accent-violet/10" : "")
          : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {selectionMode ? (
            selected
              ? <CheckCircle2 className="h-4 w-4 text-accent-violet" />
              : <Circle className="h-4 w-4 text-muted-foreground/40" />
          ) : (
            <GripVertical className="h-4 w-4 text-muted-foreground/40" />
          )}
        </div>

        <div className="h-12 w-12 rounded-lg overflow-hidden shrink-0 bg-white/5">
          {item.asset.previewUrl ? (
            <img src={item.asset.previewUrl} alt={item.asset.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-muted-foreground/30 text-micro">
              {item.asset.type === "VIDEO" ? "▶" : "IMG"}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-body font-satoshi text-foreground block truncate">
            {item.asset.name}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <PlatformDots platforms={item.platforms} />
            <span className="text-micro text-muted-foreground font-mono ml-auto shrink-0">
              {readyCount}/{item.platforms.length}
            </span>
          </div>
          {(() => {
            const firstCaption = item.captions[item.platforms[0]] ?? "";
            return firstCaption ? (
              <span className="text-micro text-muted-foreground font-satoshi mt-1 block truncate">
                {firstCaption}
              </span>
            ) : null;
          })()}
        </div>
      </div>
    </motion.div>
  );
}

// ── Calendar day cell ─────────────────────────────────────────────────────────

function DayCell({
  day,
  dateKey,
  items,
  isToday,
  isPast,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveItem,
  onDeleteConfirmed,
}: {
  day: number | null;
  dateKey: string;
  items: ScheduledAsset[];
  isToday: boolean;
  isPast: boolean;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRemoveItem: (assetId: string) => void;
  onDeleteConfirmed: (assetId: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (day === null) {
    return <div className="border-r border-b border-white/[0.04]" />;
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-r border-b border-white/[0.06] p-1.5 flex flex-col transition-colors ${
        isDragOver ? "bg-accent-violet/20 border-accent-violet/40" : ""
      } ${isPast && !isToday ? "opacity-40" : ""}`}
    >
      <span
        className={`font-mono text-body self-start mb-1 leading-none shrink-0 ${
          isToday ? "text-accent-violet font-bold" : "text-muted-foreground"
        }`}
      >
        {day}
      </span>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 overscroll-contain">
        {items.map((item) => {
          const isConfirmed = item.confirmed === true;
          const isHovered   = hoveredId === item.asset.id;
          const statusColor =
            item.dbStatus === "posted" ? "bg-success"
            : item.dbStatus === "failed" ? "bg-danger"
            : "bg-accent-violet/70";
          const timeLabel = item.scheduledAt
            ? new Date(item.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "";

          return (
            <div
              key={item.asset.id}
              className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors cursor-pointer ${
                isConfirmed
                  ? isHovered ? "bg-accent-violet/[0.18]" : "bg-accent-violet/[0.09]"
                  : "bg-white/[0.06] hover:bg-white/10"
              }`}
              title={`${item.asset.name}${timeLabel ? ` · ${timeLabel}` : ""}`}
              onMouseEnter={() => setHoveredId(item.asset.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={isConfirmed ? () => onDeleteConfirmed(item.asset.id) : () => onRemoveItem(item.asset.id)}
            >
              <div className="h-5 w-5 rounded overflow-hidden shrink-0 bg-white/10">
                {item.asset.previewUrl && (
                  <img src={item.asset.previewUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex gap-0.5 flex-wrap min-w-0 flex-1">
                {item.platforms.map((p) => {
                  const meta = PLATFORM_SHORT[p];
                  return meta ? (
                    <span
                      key={p}
                      className={`h-3.5 w-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-bold ${meta.bg} ${meta.text}`}
                    >
                      {meta.letter}
                    </span>
                  ) : null;
                })}
              </div>
              {isConfirmed ? (
                isHovered
                  ? <X className="h-2.5 w-2.5 text-muted-foreground/60 ml-auto shrink-0" />
                  : <span className={`h-1.5 w-1.5 rounded-full shrink-0 ml-auto ${statusColor}`} />
              ) : (
                <X className={`h-2.5 w-2.5 ml-auto shrink-0 transition-colors ${isHovered ? "text-muted-foreground/60" : "text-transparent"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Scheduler ────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Scheduler() {
  const {
    approvedQueue, scheduled,
    scheduleItem, unscheduleItem, deleteConfirmedItem,
    confirmSchedule, loadConfirmedSchedule,
  } = useSchedulerStore();

  const today = new Date();
  const [viewYear, setViewYear]       = useState(today.getFullYear());
  const [viewMonth, setViewMonth]     = useState(today.getMonth());
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ dateKey: string; item: ScheduledAsset } | null>(null);
  const dragging = useRef<ScheduledAsset | null>(null);

  // Shared posting state
  const [selectionMode, setSelectionMode]   = useState(false);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [postStage, setPostStage]           = useState<PostStage>(null);
  const [compressionPct, setCompressionPct] = useState(0);

  const postCallbacks = {
    onStageChange: (stage: PostStage) => {
      setPostStage(stage);
      if (stage !== "compressing") setCompressionPct(0);
    },
    onCompressionProgress: setCompressionPct,
  };

  // Load confirmed items from Supabase on mount
  useEffect(() => {
    supabase
      .from("scheduled_posts")
      .select("*")
      .in("status", ["pending", "posting", "posted", "failed"])
      .then(({ data }) => {
        if (!data?.length) return;

        const byDate: Record<string, ScheduledAsset[]> = {};
        const groupMap = new Map<string, ScheduledAsset>();

        for (const row of data) {
          const dateKey  = (row.scheduled_at as string).slice(0, 10);
          const groupKey = `${row.asset_id}:${dateKey}`;

          if (!groupMap.has(groupKey)) {
            const item: ScheduledAsset = {
              asset: {
                id: row.asset_id,
                name: row.asset_name,
                type: row.asset_type as "IMAGE" | "VIDEO" | "CLIP",
                ratio: (row.asset_ratio ?? "landscape") as "landscape" | "portrait" | "square",
                previewUrl: row.asset_preview_url ?? "",
                fileUrl: row.file_url,
                size: 0,
                source: "local" as const,
                status: "uploaded" as const,
                uploadedAt: row.created_at as string,
                episodeTag: null,
              },
              platforms: [],
              captions: {},
              scheduledAt: row.scheduled_at as string,
              confirmed: true,
              dbStatus: row.status as "pending" | "posting" | "posted" | "failed",
            };
            groupMap.set(groupKey, item);
            if (!byDate[dateKey]) byDate[dateKey] = [];
            byDate[dateKey].push(item);
          }

          const item = groupMap.get(groupKey)!;
          if (!item.platforms.includes(row.platform as string)) {
            item.platforms.push(row.platform as string);
          }
          item.captions[row.platform as string] = row.caption as string;

          // Surface the worst status for the whole item
          if (row.status === "failed") item.dbStatus = "failed";
          else if (row.status === "posting" && item.dbStatus !== "failed") item.dbStatus = "posting";
        }

        loadConfirmedSchedule(byDate);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function enterSelectionMode() {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }

  function cancelSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handlePostNow() {
    if (selectedIds.size === 0 || postStage !== null) return;
    const toPost = approvedQueue.filter((item) => selectedIds.has(item.asset.id));
    try {
      const results = await postScheduledItems(toPost, postCallbacks);
      const failed  = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        alert(`✅ Posted ${results.length} item(s) successfully.`);
      } else {
        const msgs = failed.map((r) => `${r.asset} → ${r.platform}: ${r.error}`).join("\n");
        alert(`⚠️ ${results.length - failed.length} ok, ${failed.length} failed:\n${msgs}`);
      }
    } catch (err) {
      alert(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cancelSelectionMode();
    }
  }

  // Save only NEW (unconfirmed) items to Supabase, then lock them
  async function handlePublishOnSchedule() {
    if (postStage !== null) return;

    const newItems: Array<{ item: ScheduledAsset }> = [];
    for (const items of Object.values(scheduled)) {
      for (const item of items) {
        if (!item.confirmed && item.scheduledAt) {
          newItems.push({ item });
        }
      }
    }
    if (!newItems.length) return;

    setPostStage("posting");
    try {
      const rows = newItems.flatMap(({ item }) =>
        item.platforms.map((platform) => ({
          asset_id:          item.asset.id,
          asset_name:        item.asset.name,
          asset_type:        item.asset.type,
          asset_ratio:       item.asset.ratio,
          asset_preview_url: item.asset.previewUrl || null,
          platform,
          caption:           item.captions[platform] ?? "",
          file_url:          item.asset.fileUrl,
          file_type:         item.asset.type !== "IMAGE" ? "video" : "image",
          website_config:    item.websiteConfig ?? null,
          scheduled_at:      item.scheduledAt,
          status:            "pending",
        }))
      );

      const { error } = await supabase.from("scheduled_posts").insert(rows);
      if (error) {
        alert(`Failed to save schedule: ${error.message}`);
        return;
      }

      confirmSchedule(newItems.map(({ item }) => item.asset.id));
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPostStage(null);
    }
  }

  function handleExportToSheets() {
    const allItems = Object.entries(scheduled).flatMap(([date, items]) =>
      items.flatMap((item) =>
        item.platforms.map((platform) => ({
          date,
          time: item.scheduledAt
            ? new Date(item.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "",
          asset: item.asset.name,
          platform,
          caption: item.captions[platform] ?? "",
          status: item.dbStatus ?? (item.confirmed ? "pending" : "draft"),
        }))
      )
    );
    if (!allItems.length) return;
    const header = ["Date", "Time", "Asset", "Platform", "Caption", "Status"].join(",");
    const rows   = allItems.map((r) =>
      [r.date, r.time, r.asset, r.platform, `"${r.caption.replace(/"/g, '""')}"`, r.status].join(",")
    );
    const csv  = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `schedule-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteConfirmed(dateKey: string, assetId: string) {
    // Update UI immediately so it feels instant
    deleteConfirmedItem(dateKey, assetId);
    // Clean up Supabase in the background
    const { error } = await supabase
      .from("scheduled_posts")
      .delete()
      .eq("asset_id", assetId);
    if (error) console.error("[delete-scheduled] Supabase error:", error.message);
  }

  // Calendar math
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset  = (firstWeekday + 6) % 7;
  const monthLabel   = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
    month: "long", year: "numeric",
  });

  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const totalRows = cells.length / 7;

  function toDateKey(day: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const allItems    = Object.values(scheduled).flat();
  const totalPosts  = allItems.reduce((sum, i) => sum + i.platforms.length, 0);
  const uniquePlats = new Set(allItems.flatMap((i) => i.platforms)).size;
  const daysCovered = Object.values(scheduled).filter((arr) => arr.length > 0).length;

  // Button turns purple only when there are new unconfirmed items waiting to be saved
  const hasNewItems = allItems.some((i) => !i.confirmed && Boolean(i.scheduledAt));

  return (
    <div className="flex h-full">
      {/* ── Left Staging Panel ── */}
      <div className="w-[300px] shrink-0 glass-panel border-r-0 flex flex-col">
        <div className="px-5 py-5">
          <h2 className="font-clash text-section font-bold text-foreground">Ready to Schedule</h2>
        </div>

        <div className="px-3 mb-3">
          <button className="w-full rounded-full glass-button px-4 py-2 text-body text-accent-violet font-medium flex items-center justify-center gap-2 transition-colors">
            <Sparkles className="h-3.5 w-3.5" /> Auto-fill suggestions
          </button>
        </div>

        <div className="flex-1 overflow-auto px-3">
          {approvedQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <p className="text-body text-muted-foreground font-satoshi">No assets queued.</p>
              <p className="text-micro text-muted-foreground/60 mt-1">Approve content in the Preview tab first.</p>
            </div>
          ) : (
            approvedQueue.map((item) => (
              <QueueCard
                key={item.asset.id}
                item={item}
                onDragStart={() => { dragging.current = item; }}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.asset.id)}
                onToggle={() => toggleSelect(item.asset.id)}
              />
            ))
          )}
        </div>

        <div className="border-t border-white/[0.08] px-4 py-3 flex flex-col gap-2">
          {postStage && selectionMode && (
            <div className="flex flex-col gap-1">
              <span className="font-mono text-micro text-accent-violet">
                {postStage === "compressing"
                  ? `Compressing… ${compressionPct}%`
                  : postStage === "uploading"
                  ? "Uploading compressed…"
                  : "Posting…"}
              </span>
              {postStage === "compressing" && (
                <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent-violet transition-all duration-300"
                    style={{ width: `${compressionPct}%` }}
                  />
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-micro text-muted-foreground shrink-0">
              {selectionMode
                ? `${selectedIds.size} selected`
                : `${approvedQueue.length} ${approvedQueue.length === 1 ? "asset" : "assets"} ready`}
            </span>
            {selectionMode ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelSelectionMode}
                  disabled={postStage !== null}
                  className="rounded-full glass-button px-3 py-1.5 text-micro text-muted-foreground font-medium disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePostNow}
                  disabled={selectedIds.size === 0 || postStage !== null}
                  className="rounded-full px-3 py-1.5 text-micro font-medium bg-accent-violet text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {postStage !== null ? "…" : "Post Now"}
                </button>
              </div>
            ) : (
              <button
                onClick={enterSelectionMode}
                disabled={approvedQueue.length === 0}
                className="rounded-full glass-button px-3 py-1.5 text-micro text-muted-foreground font-medium disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Test Post
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Calendar Canvas ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Month header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
          <button onClick={prevMonth} className="rounded-md p-1 text-muted-foreground hover:text-foreground glass-button">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="font-clash text-section font-bold text-foreground">{monthLabel}</span>
          <button onClick={nextMonth} className="rounded-md p-1 text-muted-foreground hover:text-foreground glass-button">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-white/[0.08]">
          {DAYS_OF_WEEK.map((d) => (
            <div key={d} className="px-2 py-2 text-center font-mono text-micro text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div
          className="flex-1 grid grid-cols-7 overflow-hidden"
          style={{ gridTemplateRows: `repeat(${totalRows}, minmax(0, 1fr))` }}
        >
          {cells.map((day, idx) => {
            const dk       = day !== null ? toDateKey(day) : `empty-${idx}`;
            const dayItems = day !== null ? (scheduled[toDateKey(day)] ?? []) : [];
            const isPast   = day !== null ? toDateKey(day) < todayKey : false;
            const isToday  = day !== null && toDateKey(day) === todayKey;

            return (
              <DayCell
                key={dk}
                day={day}
                dateKey={dk}
                items={dayItems}
                isToday={isToday}
                isPast={isPast}
                isDragOver={dragOverKey === dk && day !== null}
                onDragOver={(e) => {
                  if (day === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverKey(dk);
                }}
                onDragLeave={() => setDragOverKey(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverKey(null);
                  if (!dragging.current || day === null) return;
                  const item = dragging.current;
                  dragging.current = null;
                  // Show time picker before committing to the calendar
                  setPendingDrop({ dateKey: toDateKey(day), item });
                }}
                onRemoveItem={(assetId) => unscheduleItem(toDateKey(day!), assetId)}
                onDeleteConfirmed={(assetId) => handleDeleteConfirmed(toDateKey(day!), assetId)}
              />
            );
          })}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.08]">
          <span className="font-mono text-body text-muted-foreground">
            {totalPosts} {totalPosts === 1 ? "post" : "posts"} · {uniquePlats}{" "}
            {uniquePlats === 1 ? "platform" : "platforms"} · {daysCovered}{" "}
            {daysCovered === 1 ? "day" : "days"} covered
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportToSheets}
              disabled={totalPosts === 0}
              className="rounded-full glass-button px-4 py-2 text-body text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export to Sheets
            </button>
            <button
              onClick={handlePublishOnSchedule}
              disabled={!hasNewItems || postStage !== null}
              className={`rounded-full px-5 py-2 text-body font-medium flex items-center gap-2 transition-all ${
                hasNewItems && postStage === null
                  ? "glass-accent text-white"
                  : "glass-button text-white/35 cursor-not-allowed"
              }`}
            >
              <Send className="h-3.5 w-3.5" />
              {postStage === "posting" ? "Saving…" : "Publish on Schedule"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Time Picker Modal ── */}
      <AnimatePresence>
        {pendingDrop && (
          <TimePickerModal
            key="time-picker"
            dateKey={pendingDrop.dateKey}
            item={pendingDrop.item}
            onConfirm={(scheduledAt) => {
              scheduleItem(pendingDrop.dateKey, { ...pendingDrop.item, scheduledAt });
              setPendingDrop(null);
            }}
            onCancel={() => setPendingDrop(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
