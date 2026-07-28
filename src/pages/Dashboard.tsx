import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Calendar,
  Play,
  Image as ImageIcon,
  Film,
  Scissors,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSchedulerStore } from "@/store/schedulerStore";
import { MediaImg } from '@/components/MediaImg';

// ── Animation variants ────────────────────────────────────────────────────────

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
};

// ── Platform config ───────────────────────────────────────────────────────────

const ALL_PLATFORMS = ["x", "website", "telegram_free", "telegram_vip", "telegram_test"] as const;

const PLATFORM_INFO: Record<string, { label: string; colorClass: string; dotColor: string }> = {
  x:                { label: "X",          colorClass: "bg-platform-x/20 text-platform-x",               dotColor: "bg-platform-x" },
  telegram_free: { label: "BMM Updates",  colorClass: "bg-platform-telegram/20 text-platform-telegram", dotColor: "bg-platform-telegram" },
  telegram_vip:  { label: "BMM VIP Zone", colorClass: "bg-blue-600/20 text-blue-400",                    dotColor: "bg-blue-600" },
  telegram_test: { label: "Tele Test",    colorClass: "bg-blue-400/20 text-blue-400",                    dotColor: "bg-blue-400" },
  website:          { label: "Website",   colorClass: "bg-platform-website/20 text-platform-website",    dotColor: "bg-platform-website" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getCalendarStart(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const dow = first.getDay(); // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // shift back to Monday
  const start = new Date(year, month, 1 + offset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getCalendarCellCount(year: number, month: number): number {
  const start = getCalendarStart(year, month);
  const lastDay = new Date(year, month + 1, 0);
  const days = Math.ceil((lastDay.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.ceil(days / 7) * 7;
}

function formatScheduleTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${time}`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

interface RecentAsset {
  id: string;
  name: string;
  type: string;
  previewUrl: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { scheduled } = useSchedulerStore();

  // ── Supabase-fetched state ──────────────────────────────────────────────────

  const [recentAssets, setRecentAssets] = useState<RecentAsset[]>([]);
  const [postedThisMonth, setPostedThisMonth] = useState<Record<string, number>>({});
  const [lastMonthCount, setLastMonthCount] = useState<number | null>(null);

  const fetchPostedBreakdown = useCallback(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const { data } = await supabase
      .from("scheduled_posts")
      .select("platform")
      .eq("status", "posted")
      .gte("posted_at", monthStart)
      .lte("posted_at", monthEnd);

    if (!data) return;
    const counts: Record<string, number> = {};
    data.forEach((r) => {
      const p = r.platform as string;
      counts[p] = (counts[p] ?? 0) + 1;
    });
    setPostedThisMonth(counts);
  }, []);

  useEffect(() => {
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    // Recently imported
    supabase
      .from("assets")
      .select("id, filename, type, thumbnail_url")
      .order("uploaded_at", { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (data) {
          setRecentAssets(data.map((a) => ({
            id: a.id as string,
            name: (a.filename as string).replace(/\.[^/.]+$/, ""),
            type: a.type as string,
            previewUrl: (a.thumbnail_url as string) ?? "",
          })));
        }
      });

    // Posted breakdown this month + last month count
    fetchPostedBreakdown();
    supabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "posted")
      .gte("posted_at", lastMonthStart)
      .lte("posted_at", lastMonthEnd)
      .then(({ count }) => setLastMonthCount(count ?? 0));

    // Realtime: refresh breakdown whenever a post status changes
    const channel = supabase
      .channel("dashboard-posts")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "scheduled_posts" }, fetchPostedBreakdown)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchPostedBreakdown]);

  // ── Derived from Zustand (updates instantly on scheduler actions) ────────────

  const allItems = useMemo(
    () =>
      Object.entries(scheduled).flatMap(([dk, items]) =>
        items
          .filter((i) => i.dbStatus !== "failed")
          .map((i) => ({ item: i, dateKey: dk })),
      ),
    [scheduled],
  );

  const todayStr = useMemo(() => dateKey(new Date()), [scheduled]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayCount = useMemo(
    () =>
      allItems
        .filter(({ item }) => item.scheduledAt?.slice(0, 10) === todayStr)
        .reduce((sum, { item }) => sum + item.platforms.length, 0),
    [allItems, todayStr],
  );

  const nextPost = useMemo(() => {
    const nowIso = new Date().toISOString();
    const future = allItems
      .filter(({ item }) => item.scheduledAt && item.scheduledAt > nowIso)
      .sort((a, b) => (a.item.scheduledAt ?? "").localeCompare(b.item.scheduledAt ?? ""));
    if (!future.length) return null;
    const { item } = future[0];
    return {
      previewUrl: item.assets[0]?.previewUrl ?? "",
      assetType: item.assets[0]?.type ?? "IMAGE",
      platform: item.platforms[0] ?? "",
      scheduledAt: item.scheduledAt!,
    };
  }, [allItems]);

  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), [scheduled]); // eslint-disable-line react-hooks/exhaustive-deps

  const thisMonthCount = useMemo(
    () =>
      allItems
        .filter(({ item }) => item.scheduledAt?.slice(0, 7) === currentMonthStr)
        .reduce((sum, { item }) => sum + item.platforms.length, 0),
    [allItems, currentMonthStr],
  );

  const calendarCells = useMemo(() => {
    const today = new Date();
    const calStart = getCalendarStart(today.getFullYear(), today.getMonth());
    const cellCount = getCalendarCellCount(today.getFullYear(), today.getMonth());

    return Array.from({ length: cellCount }, (_, i) => {
      const date = new Date(calStart);
      date.setDate(calStart.getDate() + i);
      const dk = dateKey(date);
      const dayItems = (scheduled[dk] ?? []).filter((it) => it.dbStatus !== "failed");
      if (!dayItems.length) return "empty" as const;
      const platforms = new Set<string>();
      dayItems.forEach((it) => it.platforms.forEach((p) => platforms.add(p)));
      return platforms.size >= ALL_PLATFORMS.length ? ("full" as const) : ("partial" as const);
    });
  }, [scheduled]);

  const upcomingPosts = useMemo(() => {
    const nowIso = new Date().toISOString();
    return allItems
      .filter(({ item }) => item.scheduledAt && item.scheduledAt >= nowIso)
      .flatMap(({ item }) =>
        item.platforms
          .map((p) => ({
            key: `${item.groupId}-${p}-${item.scheduledAt}`,
            previewUrl: item.assets[0]?.previewUrl ?? "",
            assetType: item.assets[0]?.type ?? "IMAGE",
            platform: p,
            caption: item.captions[p] ?? item.assets[0]?.name ?? "",
            scheduledAt: item.scheduledAt!,
          })),
      )
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [allItems]);

  const platformBreakdownData = useMemo(() => {
    const telegramCount =
      (postedThisMonth["telegram_free"] ?? 0) +
      (postedThisMonth["telegram_vip"] ?? 0) +
      (postedThisMonth["telegram_test"] ?? 0);
    const xCount       = postedThisMonth["x"] ?? 0;
    const websiteCount = postedThisMonth["website"] ?? 0;
    const maxCount = Math.max(telegramCount, xCount, websiteCount, 1);
    return [
      { name: "X / Twitter", count: xCount,       color: "bg-platform-x",        width: `${(xCount / maxCount) * 100}%` },
      { name: "Telegram",    count: telegramCount, color: "bg-platform-telegram", width: `${(telegramCount / maxCount) * 100}%` },
      { name: "Website",     count: websiteCount,  color: "bg-platform-website",  width: `${(websiteCount / maxCount) * 100}%` },
    ];
  }, [postedThisMonth]);

  const monthDelta = lastMonthCount !== null ? thisMonthCount - lastMonthCount : null;

  // ── Greeting ────────────────────────────────────────────────────────────────

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="p-6 lg:p-8"
    >
      <div className="grid grid-cols-12 gap-4">

        {/* Hero Greeting */}
        <motion.div
          variants={fadeUp}
          className="col-span-12 card-surface rounded-2xl p-8 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-accent-violet/5" />
          <div className="relative flex items-center justify-between">
            <div>
              <h1 className="font-clash text-hero font-bold text-foreground leading-none">
                {greeting}, Ash.
              </h1>
              <p className="mt-3 text-section text-muted-foreground font-satoshi">
                {new Date().toLocaleDateString("en-GB", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                })}
              </p>
              <p className="mt-4 text-sub text-foreground font-satoshi">
                You have{" "}
                <span className="font-bold text-accent-violet">{todayCount} {todayCount === 1 ? "post" : "posts"}</span>{" "}
                going out today.
              </p>
            </div>

            {/* Next post preview */}
            <div className="hidden lg:flex items-center gap-4">
              <div className="relative h-32 w-48 rounded-xl card-elevated overflow-hidden">
                {nextPost?.previewUrl ? (
                  <MediaImg
                    src={nextPost.previewUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <div className="absolute inset-0 atmospheric-glow" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Play className="h-10 w-10 text-accent-violet/60" />
                    </div>
                  </>
                )}
              </div>
              {nextPost && (
                <div className="flex items-center gap-2 rounded-full glass-button px-3 py-1.5">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      PLATFORM_INFO[nextPost.platform]?.dotColor ?? "bg-accent-violet"
                    }`}
                  />
                  <span className="font-mono text-micro text-muted-foreground">
                    {PLATFORM_INFO[nextPost.platform]?.label ?? nextPost.platform}
                    {" · "}
                    {new Date(nextPost.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Content Calendar */}
        <motion.div
          variants={fadeUp}
          className="col-span-12 lg:col-span-7 card-surface rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <span className="text-sub font-satoshi text-muted-foreground">Content Calendar</span>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="text-center font-mono text-micro text-muted-foreground/60 pb-1">
                {d}
              </span>
            ))}
            {calendarCells.map((status, i) => (
              <motion.div
                key={i}
                whileHover={{ scale: 1.15 }}
                className={`aspect-square rounded-md transition-colors cursor-pointer ${
                  status === "full"
                    ? "glass-accent"
                    : status === "partial"
                    ? "bg-accent-violet/20 border border-accent-violet/20"
                    : "glass-button"
                }`}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-4">
            <span className="flex items-center gap-1.5 font-mono text-micro text-muted-foreground">
              <span className="h-2 w-2 rounded-sm glass-button" /> Empty
            </span>
            <span className="flex items-center gap-1.5 font-mono text-micro text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-accent-violet/30" /> Partial
            </span>
            <span className="flex items-center gap-1.5 font-mono text-micro text-muted-foreground">
              <span className="h-2 w-2 rounded-sm glass-accent" /> Full
            </span>
          </div>
        </motion.div>

        {/* Posts This Month + Revenue */}
        <div className="col-span-12 lg:col-span-5 grid grid-rows-2 gap-4">
          <motion.div variants={fadeUp} className="card-surface rounded-2xl p-6">
            <span className="text-body text-muted-foreground font-satoshi">Posts This Month</span>
            <div className="mt-2 flex items-end gap-3">
              <span className="font-clash text-metric font-bold text-foreground">
                {thisMonthCount}
              </span>
              {monthDelta !== null && (
                <span
                  className={`mb-1 flex items-center gap-1 text-body font-mono ${
                    monthDelta >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {monthDelta >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {monthDelta >= 0 ? "+" : ""}{monthDelta} vs last month
                </span>
              )}
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="card-surface rounded-2xl p-6">
            <span className="text-body text-muted-foreground font-satoshi">Revenue This Month</span>
            <div className="mt-2 flex items-end gap-3">
              <span className="font-mono text-metric font-bold text-foreground">£8,240</span>
            </div>
            <div className="mt-3 flex h-8 items-end gap-1">
              {[35, 42, 38, 55, 48, 62].map((v, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-accent-violet/30 border border-accent-violet/20"
                  style={{ height: `${v}%` }}
                />
              ))}
            </div>
          </motion.div>
        </div>

        {/* Recently Imported */}
        <motion.div
          variants={fadeUp}
          className="col-span-12 card-surface rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sub font-satoshi text-muted-foreground">Recently Imported</span>
            <button
              onClick={() => navigate("/library")}
              className="flex items-center gap-1 text-body text-accent-violet hover:text-accent-light transition-colors"
            >
              View Library <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recentAssets.length === 0 && (
              <p className="text-body text-muted-foreground/50 font-mono py-6 px-2">
                No assets imported yet
              </p>
            )}
            {recentAssets.map((asset) => (
              <motion.div
                key={asset.id}
                whileHover={{ scale: 1.03 }}
                onClick={() => navigate("/library")}
                className="group relative flex-shrink-0 w-36 h-24 rounded-xl card-elevated overflow-hidden cursor-pointer"
              >
                {asset.previewUrl ? (
                  <MediaImg
                    src={asset.previewUrl}
                    alt={asset.name}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <div className="absolute inset-0 atmospheric-glow opacity-50" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {asset.type === "VIDEO" ? (
                        <Film className="h-5 w-5 text-muted-foreground/40" />
                      ) : asset.type === "CLIP" ? (
                        <Scissors className="h-5 w-5 text-muted-foreground/40" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                      )}
                    </div>
                  </>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-micro text-foreground font-mono">{asset.name}</span>
                </div>
                <div className="absolute top-2 right-2">
                  <span className="rounded-md glass-button px-1.5 py-0.5 text-micro font-mono text-muted-foreground">
                    {asset.type}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Platform Breakdown */}
        <motion.div
          variants={fadeUp}
          className="col-span-12 lg:col-span-6 card-surface rounded-2xl p-6"
        >
          <span className="text-sub font-satoshi text-muted-foreground">Platform Posting Breakdown</span>
          <div className="mt-5 flex flex-col gap-3">
            {platformBreakdownData.map((p) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="w-24 text-body font-satoshi text-foreground truncate">{p.name}</span>
                <div className="flex-1 h-3 rounded-full glass-button overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: p.width }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                    className={`h-full rounded-full ${p.color}`}
                  />
                </div>
                <span className="font-mono text-body text-muted-foreground w-6 text-right">{p.count}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Upcoming Posts */}
        <motion.div
          variants={fadeUp}
          className="col-span-12 lg:col-span-6 card-surface rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sub font-satoshi text-muted-foreground">Upcoming Posts</span>
            <button
              onClick={() => navigate("/scheduler")}
              className="flex items-center gap-1 text-body text-accent-violet hover:text-accent-light transition-colors"
            >
              View Scheduler <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
            {upcomingPosts.length === 0 && (
              <p className="text-center text-body text-muted-foreground/50 font-mono py-6">
                No upcoming posts scheduled
              </p>
            )}
            {upcomingPosts.map((post) => (
              <div
                key={post.key}
                className="flex items-center gap-3 rounded-lg glass-button p-3 transition-colors"
              >
                {/* Thumbnail */}
                <div className="h-10 w-10 rounded-lg card-elevated overflow-hidden flex items-center justify-center shrink-0">
                  {post.previewUrl ? (
                    <MediaImg
                      src={post.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Play className="h-4 w-4 text-muted-foreground/60" />
                  )}
                </div>

                {/* Platform pill */}
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-micro font-mono font-medium ${
                    PLATFORM_INFO[post.platform]?.colorClass ?? "bg-accent-violet/20 text-accent-violet"
                  }`}
                >
                  {PLATFORM_INFO[post.platform]?.label ?? post.platform}
                </span>

                {/* Caption */}
                <span className="flex-1 text-body text-foreground truncate font-satoshi">
                  {post.caption}
                </span>

                {/* Time */}
                <span className="font-mono text-micro text-muted-foreground shrink-0">
                  {formatScheduleTime(post.scheduledAt)}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
}
