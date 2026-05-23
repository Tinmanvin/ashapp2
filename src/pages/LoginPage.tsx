import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Invalid email or password.");
      setLoading(false);
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-background">
      {/* Atmospheric violet glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="h-[700px] w-[700px] rounded-full blur-[140px]"
          style={{ background: "hsl(256 90% 66% / 0.08)" }}
        />
      </div>
      {/* Secondary offset glow */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/3 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]"
          style={{ background: "hsl(263 95% 76% / 0.05)" }}
        />
      </div>

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="card-surface relative z-10 w-full max-w-[400px] rounded-2xl p-8"
        style={{ boxShadow: "0 0 0 1px hsl(240 7% 18%), 0 24px 48px hsl(240 7% 2% / 0.6)" }}
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="mb-8 flex justify-center"
        >
          <img
            src="/bm-logo.png"
            alt="Black Magic"
            className="h-8 w-auto object-contain"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <h1 className="font-clash text-section font-bold text-foreground leading-tight">
            Welcome back.
          </h1>
          <p className="mt-1.5 text-body text-muted-foreground font-satoshi">
            Sign in to access the content hub.
          </p>
        </motion.div>

        <motion.form
          onSubmit={handleSubmit}
          className="mt-7 flex flex-col gap-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.4 }}
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-micro font-medium uppercase tracking-widest text-muted-foreground font-satoshi">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="rounded-lg border border-border bg-[hsl(240_7%_6%)] px-3.5 py-2.5 text-body text-foreground font-satoshi placeholder:text-muted-foreground/40 transition-colors focus:border-[hsl(256_90%_66%)] focus:outline-none focus:ring-1 focus:ring-[hsl(256_90%_66%/0.4)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-micro font-medium uppercase tracking-widest text-muted-foreground font-satoshi">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="rounded-lg border border-border bg-[hsl(240_7%_6%)] px-3.5 py-2.5 text-body text-foreground font-satoshi placeholder:text-muted-foreground/40 transition-colors focus:border-[hsl(256_90%_66%)] focus:outline-none focus:ring-1 focus:ring-[hsl(256_90%_66%/0.4)]"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-body text-danger font-satoshi"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-lg py-2.5 text-body font-medium text-white font-satoshi transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: "hsl(256 90% 66%)",
              boxShadow: loading ? "none" : "0 0 20px hsl(256 90% 66% / 0.25)",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 0 32px hsl(256 90% 66% / 0.45)";
                (e.currentTarget as HTMLButtonElement).style.background =
                  "hsl(256 90% 72%)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                "0 0 20px hsl(256 90% 66% / 0.25)";
              (e.currentTarget as HTMLButtonElement).style.background =
                "hsl(256 90% 66%)";
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </motion.form>
      </motion.div>
    </div>
  );
}
