import { useEffect } from "react";
import { useLocation } from "wouter";
import { loadAdminSession, clearAdminSession } from "./admin-login";
import { SuperadminAccountingView } from "@/components/superadmin-accounting-view";
import { Button } from "@/components/ui/button";
import { Shield, ArrowLeft, LogOut } from "lucide-react";

export default function SuperadminAccountingPage() {
  const [, navigate] = useLocation();
  const session = loadAdminSession();

  useEffect(() => {
    if (!session) {
      navigate("/admin-login");
    } else if (session.role !== "superadmin") {
      navigate("/admin");
    }
  }, [session, navigate]);

  if (!session || session.role !== "superadmin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Shield className="w-8 h-8 text-destructive mx-auto" />
          <h2 className="text-lg font-bold">Accès restreint</h2>
          <p className="text-xs text-muted-foreground">
            Seuls les superadministrateurs ont accès au grand livre comptable.
          </p>
          <Button size="sm" onClick={() => navigate("/admin-login")}>
            Se connecter
          </Button>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-background border-b shadow-xs">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin")}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Retour Admin
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Shield className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <div>
                <h1 className="font-bold text-sm leading-none">Grand Livre Comptable Superadmin</h1>
                <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                  Audit en partie double, écritures immuables et réconciliations
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/")}
              className="h-8 text-xs"
            >
              Marketplace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-8 text-xs text-destructive hover:text-destructive"
            >
              <LogOut className="w-3.5 h-3.5 mr-1" />
              Déconnexion
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <SuperadminAccountingView adminCode={session.code} />
      </main>
    </div>
  );
}
