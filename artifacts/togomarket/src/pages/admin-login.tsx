import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, Eye, EyeOff, Lock } from "lucide-react";

const STORAGE_KEY = "togomarket_admin_session";

export function saveAdminSession(role: string, code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ role, code, at: Date.now() }));
  } catch {}
}

export function loadAdminSession(): { role: string; code: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const age = Date.now() - (parsed.at ?? 0);
    if (age > 8 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAdminSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    const trimmed = code.trim();
    if (!trimmed) { setError("Veuillez entrer votre code."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError("Code incorrect. Vérifiez votre code d'accès.");
        return;
      }
      saveAdminSession(data.role, trimmed);
      navigate("/");
    } catch {
      setError("Erreur de connexion. Réessayez.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Administration</h1>
          <p className="text-muted-foreground text-sm mt-1">TogoMarket — Accès sécurisé</p>
        </div>

        <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              Code d'accès
            </label>
            <div className="relative">
              <Input
                type={showCode ? "text" : "password"}
                placeholder="Entrez votre code…"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="pr-10 text-center text-lg tracking-widest font-mono"
                maxLength={6}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowCode((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-3 py-2 text-center">
              {error}
            </div>
          )}

          <Button className="w-full h-11" onClick={handleLogin} disabled={loading}>
            {loading ? "Vérification…" : "Se connecter"}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Superadmin : 5 chiffres · Sous-admin : 4 chiffres
          </p>
        </div>

        <button
          onClick={() => navigate("/")}
          className="mt-4 text-xs text-muted-foreground underline w-full text-center block"
        >
          ← Retour à la marketplace
        </button>
      </div>
    </div>
  );
}
