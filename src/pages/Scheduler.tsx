import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Sparkles, GripVertical, X } from "lucide-react";
import { useSchedulerStore, type ScheduledAsset } from "@/store/schedulerStore";
import { PLATFORM_META } from "@/lib/captionPrompts";

// ── Platform display helpers ──────────────────────────────────────────────────

const PLATFORM_SHORT: Record<string, { letter: string; bg: string; text: string }> = {
  x:             { letter: "X", bg: "bg-platform-x",       text: "text-black"   },
  reddit:        { letter: "R", bg: "bg-platform-reddit",  text: "text-white"   },
  telegram_free: { letter: "T", bg: "bg-platform-telegram",text: "text-white"   },
  telegram_vip:  { letter: "V", bg: "bg-blue-600",         text: "text-white"   },
  website:       { letter: "W", bg: "bg-platform-website", text: "text-white"   },
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

// ── Sidebar draggable card ─────────────────────────────────────────────────────

function QueueCard({
  item,
  onDragStart,
}: {
  item: ScheduledAsset;
  onDragStart: () => void;
}) {
  const readyCount = item.platforms.filter(
    (p) => (item.captions[p] ?? "").trim().length > 0
  ).length;

  return (
    <motion.div
      draggable
      onDragStart={onDragStart}
      whileHover={{ scale: 1.02 }}
      className="card-surface rounded-xl p-3 mb-2 cursor-grab active:cursor-grabbing select-none"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <GripVertical className="h-4 w-4 text-muted-foreground/40" />
        </div>

        {/* Thumbnail */}
        <div className="h-12 w-12 rounded-lg overflow-hidden shrink-0 bg-white/5">
          {item.asset.previewUrl ? (
            <img
              src={item.asset.previewUrl}
              alt={item.asset.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-muted-foreground/30 text-micro">
              {item.asset.type === "video" ? "▶" : "IMG"}
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
          {/* Caption preview from first platform */}
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

// ── Calendar day cell ──────────────────────────────────────────────────────────

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
}) {
  if (day === null) {
    return <div className="border-r border-b border-white/[0.04]" />;
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-r border-b border-white/[0.06] p-1.5 flex flex-col transition-colors overflow-hidden ${
        isDragOver ? "bg-accent-violet/20 border-accent-violet/40" : ""
      } ${isPast && !isToday ? "opacity-40" : ""}`}
    >
      <span
        className={`font-mono text-body self-start mb-1 leading-none ${
          isToday
            ? "text-accent-violet font-bold"
            : "text-muted-foreground"
        }`}
      >
        {day}
      </span>

      <div className="flex flex-col gap-0.5 overflow-hidden">
        {items.map((item) => (
          <div
            key={item.asset.id}
            className="flex items-center gap-1 bg-white/[0.06] rounded px-1 py-0.5 group cursor-pointer"
            title={item.asset.name}
            onClick={() => onRemoveItem(item.asset.id)}
          >
            <div className="h-5 w-5 rounded overflow-hidden shrink-0 bg-white/10">
              {item.asset.previewUrl && (
                <img
                  src={item.asset.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="flex gap-0.5 flex-wrap min-w-0">
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
            <X className="h-2.5 w-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors ml-auto shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Scheduler ─────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Scheduler() {
  const { approvedQueue, scheduled, scheduleItem, unscheduleItem } = useSchedulerStore();

  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragging = useRef<ScheduledAsset | null>(null);

  // Calendar math
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const startOffset  = (firstWeekday + 6) % 7; // convert to Mon-start
  const monthLabel   = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Cells: null = empty lead-in, number = day
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

  // Bottom stats — across all scheduled days, not just current view
  const allItems    = Object.values(scheduled).flat();
  const totalPosts  = allItems.reduce((sum, i) => sum + i.platforms.length, 0);
  const uniquePlats = new Set(allItems.flatMap((i) => i.platforms)).size;
  const daysCovered = Object.values(scheduled).filter((arr) => arr.length > 0).length;

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
              />
            ))
          )}
        </div>

        <div className="border-t border-white/[0.08] px-5 py-3">
          <span className="font-mono text-micro text-muted-foreground">
            {approvedQueue.length} {approvedQueue.length === 1 ? "asset" : "assets"} ready
          </span>
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

        {/* Day-of-week headers */}
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
            const dk = day !== null ? toDateKey(day) : `empty-${idx}`;
            const dayItems = day !== null ? (scheduled[toDateKey(day)] ?? []) : [];
            const isPast = day !== null
              ? toDateKey(day) < todayKey
              : false;
            const isToday = day !== null && toDateKey(day) === todayKey;

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
                  scheduleItem(toDateKey(day), dragging.current);
                  dragging.current = null;
                }}
                onRemoveItem={(assetId) => unscheduleItem(toDateKey(day!), assetId)}
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
              disabled
              className="rounded-full glass-button px-5 py-2 text-body font-medium text-white/40 flex items-center gap-2 cursor-not-allowed"
              title="Publishing pipeline coming soon"
            >
              Publish on Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
