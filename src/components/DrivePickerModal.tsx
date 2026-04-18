import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, HardDrive, Loader2, Image as ImageIcon, Film, Check, LogOut, AlertCircle } from "lucide-react";
import {
  getAccessToken,
  listDriveFiles,
  downloadDriveFile,
  clearDriveToken,
  isDriveAvailable,
  type DriveFile,
} from "@/lib/googleDrive";

interface Props {
  onFilesSelected: (files: File[]) => void;
  onClose: () => void;
}

type Phase = "idle" | "signing-in" | "loading" | "browsing" | "downloading" | "error";

export default function DrivePickerModal({ onFilesSelected, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  const handleSignIn = useCallback(async () => {
    setPhase("signing-in");
    setError(null);
    try {
      const t = await getAccessToken();
      setToken(t);
      setPhase("loading");
      const result = await listDriveFiles(t);
      setFiles(result.files);
      setNextPageToken(result.nextPageToken);
      setPhase("browsing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("popup") || msg.toLowerCase().includes("closed")) {
        setPhase("idle"); // user closed the popup — no error
      } else {
        setError(msg);
        setPhase("error");
      }
    }
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (!token || !nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listDriveFiles(token, nextPageToken);
      setFiles((prev) => [...prev, ...result.files]);
      setNextPageToken(result.nextPageToken);
    } finally {
      setLoadingMore(false);
    }
  }, [token, nextPageToken, loadingMore]);

  const toggleFile = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddFiles = useCallback(async () => {
    if (!token || selected.size === 0) return;
    setPhase("downloading");
    try {
      const toDownload = files.filter((f) => selected.has(f.id));
      const downloaded: File[] = [];
      for (const f of toDownload) {
        const file = await downloadDriveFile(token, f);
        downloaded.push(file);
      }
      onFilesSelected(downloaded);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [token, selected, files, onFilesSelected, onClose]);

  const handleSignOut = () => {
    clearDriveToken();
    setToken(null);
    setFiles([]);
    setSelected(new Set());
    setPhase("idle");
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isVideo = (mimeType: string) => mimeType.startsWith("video/");

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(10, 10, 11, 0.85)", backdropFilter: "blur(8px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="card-surface rounded-2xl w-full flex flex-col"
          style={{ maxWidth: 760, maxHeight: "80vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <HardDrive className="h-4 w-4 text-accent-violet" />
              <span className="font-satoshi font-semibold text-foreground text-sub">Google Drive</span>
              {phase === "browsing" && (
                <span className="text-micro text-muted-foreground font-satoshi">
                  {files.length} media files
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {phase === "browsing" && token && (
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 rounded-full glass-button px-3 py-1.5 text-micro text-muted-foreground hover:text-foreground transition-colors"
                >
                  <LogOut className="h-3 w-3" />
                  Sign out
                </button>
              )}
              <button
                onClick={onClose}
                className="h-7 w-7 rounded-full glass-button flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col">

            {/* ── Not configured ── */}
            {!isDriveAvailable && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                <AlertCircle className="h-10 w-10 text-warning/60" />
                <div>
                  <p className="font-satoshi font-semibold text-foreground mb-1">Google Drive not configured</p>
                  <p className="text-body text-muted-foreground font-satoshi max-w-sm">
                    Add <code className="text-accent-violet bg-white/[0.06] px-1.5 py-0.5 rounded text-micro">VITE_GOOGLE_CLIENT_ID</code> to your <code className="text-accent-violet bg-white/[0.06] px-1.5 py-0.5 rounded text-micro">.env.local</code> file.
                    Get it from Google Cloud Console → Credentials.
                  </p>
                </div>
              </div>
            )}

            {/* ── Sign in prompt ── */}
            {isDriveAvailable && phase === "idle" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
                <div className="h-16 w-16 rounded-2xl glass-button flex items-center justify-center">
                  <HardDrive className="h-7 w-7 text-accent-violet" />
                </div>
                <div className="text-center">
                  <p className="font-clash font-semibold text-foreground text-sub mb-1.5">Connect Google Drive</p>
                  <p className="text-body text-muted-foreground font-satoshi max-w-xs">
                    Sign in to browse and import photos and videos directly from your Drive.
                  </p>
                </div>
                <button
                  onClick={handleSignIn}
                  className="glass-accent text-white font-satoshi font-semibold rounded-full px-6 py-2.5 text-sub flex items-center gap-2.5 hover:brightness-110 transition-all"
                >
                  {/* Google logo */}
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </button>
              </div>
            )}

            {/* ── Signing in / loading ── */}
            {(phase === "signing-in" || phase === "loading") && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 text-accent-violet animate-spin" />
                <p className="text-body text-muted-foreground font-satoshi">
                  {phase === "signing-in" ? "Opening Google sign-in…" : "Loading your Drive…"}
                </p>
              </div>
            )}

            {/* ── Downloading ── */}
            {phase === "downloading" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 text-accent-violet animate-spin" />
                <p className="text-body text-muted-foreground font-satoshi">
                  Downloading {selected.size} file{selected.size > 1 ? "s" : ""}…
                </p>
              </div>
            )}

            {/* ── Error ── */}
            {phase === "error" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                <AlertCircle className="h-8 w-8 text-danger/70" />
                <div>
                  <p className="font-satoshi font-semibold text-foreground mb-1">Something went wrong</p>
                  <p className="text-body text-muted-foreground font-satoshi max-w-sm">{error}</p>
                </div>
                <button
                  onClick={() => setPhase("idle")}
                  className="glass-button rounded-full px-4 py-2 text-body text-muted-foreground hover:text-foreground transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {/* ── File browser ── */}
            {phase === "browsing" && (
              <>
                <div className="flex-1 overflow-y-auto p-4">
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center gap-2">
                      <p className="text-body text-muted-foreground font-satoshi">No photos or videos found in your Drive.</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                        {files.map((file) => {
                          const isSelected = selected.has(file.id);
                          const video = isVideo(file.mimeType);
                          return (
                            <motion.button
                              key={file.id}
                              whileHover={{ scale: 1.04 }}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => toggleFile(file.id)}
                              className={`relative aspect-square rounded-lg overflow-hidden card-elevated transition-shadow ${
                                isSelected ? "glow-ring" : ""
                              }`}
                            >
                              {/* Thumbnail */}
                              {file.thumbnailLink ? (
                                <img
                                  src={file.thumbnailLink}
                                  alt={file.name}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center atmospheric-glow opacity-20">
                                  {video ? (
                                    <Film className="h-6 w-6 text-muted-foreground/40" />
                                  ) : (
                                    <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                                  )}
                                </div>
                              )}

                              {/* Dark overlay */}
                              <div className={`absolute inset-0 transition-colors ${isSelected ? "bg-accent-violet/20" : "bg-black/10 hover:bg-black/20"}`} />

                              {/* Video badge */}
                              {video && (
                                <div className="absolute bottom-1 left-1">
                                  <span className="rounded glass-button px-1 py-0.5 font-mono text-micro text-muted-foreground">VID</span>
                                </div>
                              )}

                              {/* Selected checkmark */}
                              {isSelected && (
                                <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full glass-accent flex items-center justify-center">
                                  <Check className="h-3 w-3 text-white" />
                                </div>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>

                      {/* Load more */}
                      {nextPageToken && (
                        <div className="flex justify-center mt-4">
                          <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="glass-button rounded-full px-5 py-2 text-body text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 disabled:opacity-50"
                          >
                            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Load more
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                {selected.size > 0 && (
                  <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-between">
                    <span className="text-body text-muted-foreground font-satoshi">
                      {selected.size} file{selected.size > 1 ? "s" : ""} selected
                    </span>
                    <button
                      onClick={handleAddFiles}
                      className="glass-accent text-white font-satoshi font-semibold rounded-full px-5 py-2 text-body flex items-center gap-2 hover:brightness-110 transition-all"
                    >
                      Add {selected.size} to library
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
