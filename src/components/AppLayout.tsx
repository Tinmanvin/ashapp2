import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Grid3X3,
  Sparkles,
  Eye,
  Calendar,
  Settings,
  FolderOpen,
  Film,
  Image,
  Scissors,
  Clapperboard,
  Star,
  Camera,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useProcessingStore } from "@/store/processingStore";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/library", icon: Grid3X3, label: "Library" },
  { to: "/processing", icon: Sparkles, label: "Processing" },
  { to: "/preview", icon: Eye, label: "Preview" },
  { to: "/scheduler", icon: Calendar, label: "Scheduler" },
];

const TAG_TO_LABEL: Record<string, string> = {
  Episode: "Episodes",
  Clip: "Clips",
  Photo: "Photos",
  Trailer: "Trailers",
  Teaser: "Teasers",
  BTS: "BTS",
};

const folders = [
  { icon: FolderOpen, label: "All Assets", nav: null },
  { icon: Film, label: "Episodes", nav: "Episodes" },
  { icon: Scissors, label: "Clips", nav: "Clips" },
  { icon: Image, label: "Photos", nav: "Photos" },
  { icon: Clapperboard, label: "Trailers", nav: "Trailers" },
  { icon: Star, label: "Teasers", nav: "Teasers" },
  { icon: Camera, label: "BTS", nav: "BTS" },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activeNav = searchParams.get("nav");

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    async function loadCounts() {
      const { data, error } = await supabase
        .from("assets")
        .select("episode_tag");

      if (error || !data) return;

      const totals: Record<string, number> = {};
      for (const row of data as { episode_tag: string | null }[]) {
        const tag = row.episode_tag;
        if (tag) {
          const label = TAG_TO_LABEL[tag] ?? tag;
          totals[label] = (totals[label] ?? 0) + 1;
        }
      }
      setCounts(totals);
      setTotalCount(data.length);
    }

    loadCounts();

    const channel = supabase
      .channel("asset-tag-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets" },
        () => loadCounts()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const { clear: clearPipeline, selectedAssets } = useProcessingStore();
  const pipelineCount = selectedAssets.length;

  const isLibrary = location.pathname === "/library";

  const handleFolderClick = (nav: string | null) => {
    if (nav) {
      navigate(`/library?nav=${encodeURIComponent(nav)}`);
    } else {
      navigate("/library");
    }
  };

  const isFolderActive = (nav: string | null) => {
    if (!isLibrary) return false;
    if (nav === null) return !activeNav;
    return activeNav === nav;
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left Sidebar */}
      <motion.aside
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-[220px] flex-col border-r border-border bg-sidebar shrink-0"
      >
        {/* Logo */}
        <div className="flex items-center justify-center px-5 py-5">
          <img src="/bm-logo.png" alt="Black Magic Entertainment" className="h-10 w-auto object-contain" />
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 px-3 mt-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-body transition-all duration-150 ${
                  isActive
                    ? "bg-elevated text-foreground"
                    : "text-muted-foreground hover:bg-elevated/50 hover:text-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={`h-[18px] w-[18px] ${isActive ? "text-accent-violet" : ""}`}
                    strokeWidth={isActive ? 2.2 : 1.5}
                  />
                  <span className="font-satoshi">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Folder tree */}
        <div className="mt-6 border-t border-border px-3 pt-4">
          <span className="px-3 text-micro font-medium uppercase tracking-widest text-muted-foreground">
            Library
          </span>
          <div className="mt-3 flex flex-col gap-0.5">
            {folders.map((f) => {
              const active = isFolderActive(f.nav);
              const count = f.nav === null ? totalCount : (counts[f.label] ?? 0);
              return (
                <button
                  key={f.label}
                  onClick={() => handleFolderClick(f.nav)}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-body transition-colors ${
                    active
                      ? "bg-elevated text-foreground"
                      : "text-muted-foreground hover:bg-elevated/50 hover:text-foreground"
                  }`}
                >
                  <f.icon
                    className={`h-3.5 w-3.5 ${active ? "text-accent-violet" : ""}`}
                    strokeWidth={active ? 2.2 : 1.5}
                  />
                  <span className="flex-1 text-left font-satoshi">{f.label}</span>
                  <span className="rounded-md bg-elevated px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Clear pipeline */}
          {pipelineCount > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                onClick={() => {
                  clearPipeline();
                  toast.success("Pipeline cleared");
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-body text-muted-foreground/60 hover:bg-danger/10 hover:text-danger transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="flex-1 text-left font-satoshi">Clear pipeline</span>
                <span className="rounded-md bg-elevated px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                  {pipelineCount}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Bottom */}
        <div className="mt-auto border-t border-border px-3 py-3">
          <NavLink
            to="/settings"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-body text-muted-foreground transition-colors hover:bg-elevated/50 hover:text-foreground"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.5} />
            <span className="font-satoshi">Settings</span>
          </NavLink>
          <div className="mt-3 flex items-center gap-2.5 px-3">
            <div className="h-7 w-7 rounded-full bg-accent-violet/20 flex items-center justify-center">
              <span className="text-micro font-bold text-accent-violet">A</span>
            </div>
            <div className="flex flex-col">
              <span className="text-body font-medium text-foreground">Ash</span>
              <span className="text-micro text-muted-foreground">Creator</span>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
