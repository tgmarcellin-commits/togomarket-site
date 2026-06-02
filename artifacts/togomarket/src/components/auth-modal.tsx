import { useState } from "react";
import { useVendorRegister, useVendorLogin, type VendorProfile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, LogIn, Eye, EyeOff } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: (vendor: VendorProfile, password: string) => void;
  whatsappCommission: string;
}

type Screen = "choice" | "login" | "register" | "verify";

interface VerifyInfo {
  verifyCode: string;
  phone: string;
  firstName: string;
}

export function AuthModal({ open, onOpenChange, onLoginSuccess, whatsappCommission }: AuthModalProps) {
  const { toast } = useToast();
  const [screen, setScreen] = useState<Screen>("choice");
  const [verifyInfo, setVerifyInfo] = useState<VerifyInfo | null>(null);

  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegPwd2, setShowRegPwd2] = useState(false);

  const [regFirstName, setRegFirstName] = useState("");
  const [regLastName, setRegLastName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPassword2, setRegPassword2] = useState("");

  const registerMutation = useVendorRegister();
  const loginMutation = useVendorLogin();

  const resetAll = () => {
    setScreen("choice");
    setLoginPhone("");
    setLoginPassword("");
    setRegFirstName("");
    setRegLastName("");
    setRegPhone("");
    setRegPassword("");
    setRegPassword2("");
    setVerifyInfo(null);
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) resetAll();
    onOpenChange(val);
  };

  const handleLogin = () => {
    if (!loginPhone.trim() || !loginPassword.trim()) {
      toast({ title: "Champs requis", variant: "destructive" });
      return;
    }
    loginMutation.mutate(
      { data: { phone: loginPhone.trim(), password: loginPassword } },
      {
        onSuccess: (vendor) => {
          toast({
            title: `Bienvenue, ${vendor.firstName} !`,
            description: vendor.verified
              ? "Vous êtes connecté."
              : "Votre compte est en attente d'activation par l'administrateur.",
          });
          onLoginSuccess(vendor, loginPassword);
          resetAll();
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Numéro ou mot de passe incorrect", variant: "destructive" });
        },
      }
    );
  };

  const handleRegister = () => {
    if (!regFirstName.trim() || !regLastName.trim() || !regPhone.trim() || !regPassword.trim()) {
      toast({ title: "Tous les champs sont requis", variant: "destructive" });
      return;
    }
    if (regPassword !== regPassword2) {
      toast({ title: "Les mots de passe ne correspondent pas", variant: "destructive" });
      return;
    }
    if (regPassword.length < 6) {
      toast({ title: "Mot de passe trop court (6 caractères minimum)", variant: "destructive" });
      return;
    }
    registerMutation.mutate(
      {
        data: {
          firstName: regFirstName.trim(),
          lastName: regLastName.trim(),
          phone: regPhone.trim(),
          password: regPassword,
        },
      },
      {
        onSuccess: (result) => {
          setVerifyInfo({
            verifyCode: result.verifyCode,
            phone: result.phone,
            firstName: result.firstName,
          });
          setScreen("verify");
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          if (msg.includes("409") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("inscrit")) {
            toast({ title: "Ce numéro est déjà inscrit.", description: "Connectez-vous à la place.", variant: "destructive" });
          } else {
            toast({ title: "Erreur lors de l'inscription", variant: "destructive" });
          }
        },
      }
    );
  };

  const handleSendWhatsApp = () => {
    if (!verifyInfo) return;
    const msg = `Bonjour ! Je souhaite activer mon compte vendeur TogoMarket.\nNom : ${verifyInfo.firstName}\nNuméro : ${verifyInfo.phone}\nCode de vérification : ${verifyInfo.verifyCode}`;
    window.open(`https://wa.me/${whatsappCommission}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {screen === "choice" && "Mon Compte Vendeur"}
            {screen === "login" && "Se connecter"}
            {screen === "register" && "Créer un compte"}
            {screen === "verify" && "Vérification du numéro"}
          </DialogTitle>
        </DialogHeader>

        {screen === "choice" && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Connectez-vous ou créez un compte pour publier vos annonces sur TogoMarket.
            </p>
            <Button
              className="w-full h-12 gap-2"
              onClick={() => setScreen("login")}
            >
              <LogIn className="w-4 h-4" />
              Se connecter
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 gap-2"
              onClick={() => setScreen("register")}
            >
              <UserPlus className="w-4 h-4" />
              Créer un compte
            </Button>
          </div>
        )}

        {screen === "login" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Numéro WhatsApp</label>
              <Input
                placeholder="+228 XX XX XX XX"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mot de passe</label>
              <div className="relative">
                <Input
                  type={showLoginPwd ? "text" : "password"}
                  placeholder="Votre mot de passe"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowLoginPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showLoginPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={handleLogin}
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Connexion..." : "Se connecter"}
            </Button>
            <button
              className="text-xs text-muted-foreground underline w-full text-center"
              onClick={() => setScreen("choice")}
            >
              Retour
            </button>
          </div>
        )}

        {screen === "register" && (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Prénom</label>
                <Input
                  placeholder="Kofi"
                  value={regFirstName}
                  onChange={(e) => setRegFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nom</label>
                <Input
                  placeholder="Mensah"
                  value={regLastName}
                  onChange={(e) => setRegLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Numéro WhatsApp</label>
              <Input
                placeholder="+228 XX XX XX XX"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mot de passe</label>
              <div className="relative">
                <Input
                  type={showRegPwd ? "text" : "password"}
                  placeholder="Minimum 6 caractères"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowRegPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showRegPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Confirmer le mot de passe</label>
              <div className="relative">
                <Input
                  type={showRegPwd2 ? "text" : "password"}
                  placeholder="Répétez le mot de passe"
                  value={regPassword2}
                  onChange={(e) => setRegPassword2(e.target.value)}
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowRegPwd2((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showRegPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-lg p-3">
              1 mois gratuit offert à l'inscription. Ensuite 1 000 FCFA/mois pour continuer à publier.
            </div>
            <Button
              className="w-full"
              onClick={handleRegister}
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? "Inscription..." : "Créer mon compte"}
            </Button>
            <button
              className="text-xs text-muted-foreground underline w-full text-center"
              onClick={() => setScreen("choice")}
            >
              Retour
            </button>
          </div>
        )}

        {screen === "verify" && verifyInfo && (
          <div className="space-y-5 pt-2">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <span className="text-3xl">✓</span>
              </div>
              <h3 className="font-semibold text-lg">Compte créé !</h3>
              <p className="text-sm text-muted-foreground">
                Pour activer votre compte, envoyez ce code à l'administrateur sur WhatsApp depuis votre numéro <strong>{verifyInfo.phone}</strong>.
              </p>
            </div>

            <div className="bg-muted rounded-xl p-5 text-center">
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Votre code de vérification</p>
              <p className="text-4xl font-mono font-extrabold tracking-widest text-primary">{verifyInfo.verifyCode}</p>
            </div>

            <Button
              className="w-full bg-green-500 hover:bg-green-600 text-white gap-2"
              onClick={handleSendWhatsApp}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Envoyer le code sur WhatsApp
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              L'administrateur activera votre compte après réception. Vous pourrez alors vous connecter.
            </p>

            <button
              className="text-xs text-muted-foreground underline w-full text-center"
              onClick={() => { resetAll(); onOpenChange(false); }}
            >
              Fermer
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
