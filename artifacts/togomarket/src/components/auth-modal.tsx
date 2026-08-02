import { useState, useRef } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
import { useVendorRegister, useVendorLogin, useVendorVerifyOtp, useVendorResendOtp, useVendorRequestManualActivation, type VendorProfile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, LogIn, Eye, EyeOff, ShieldCheck, HelpCircle, Camera, X } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";
import { uploadImageFile } from "@/lib/upload";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: (vendor: VendorProfile, password: string) => void;
  referredBy?: number;
}

type Screen = "choice" | "login" | "register" | "privacy" | "verify";

const FEDAPAY_COUNTRIES = [
  { code: "TG", name: "Togo",          dialCode: "228", flag: "🇹🇬", hint: null },
  { code: "BJ", name: "Bénin",         dialCode: "229", flag: "🇧🇯", hint: "Ancien (229 XXXXXXXX) et nouveau format (229 01 XXXXXXXX) acceptés" },
  { code: "CI", name: "Côte d'Ivoire", dialCode: "225", flag: "🇨🇮", hint: null },
  { code: "SN", name: "Sénégal",       dialCode: "221", flag: "🇸🇳", hint: null },
  { code: "NE", name: "Niger",         dialCode: "227", flag: "🇳🇪", hint: null },
] as const;

interface VerifyInfo {
  phone: string;
  firstName: string;
}

interface PendingRegister {
  firstName: string;
  lastName: string;
  shopName?: string | null;
  phone: string;
  password: string;
  referredBy?: number;
  profilePhoto?: string | null;
  wantsNotifications?: boolean;
}

const PRIVACY_POLICY_FR = `TogoMarket collecte uniquement les informations nécessaires au fonctionnement de la plateforme : nom, prénom, numéro de téléphone, photo de profil et contenu de vos annonces.

🔒 Confidentialité des conversations
Toutes les communications échangées sur TogoMarket (messagerie acheteur-vendeur) sont transmises via une connexion sécurisée HTTPS (chiffrement TLS). L'accès aux messages est strictement limité aux participants de chaque conversation grâce à un système de jetons sécurisés. TogoMarket s'engage formellement à ne pas consulter, surveiller ni divulguer le contenu de vos conversations privées. Aucun tiers ne peut accéder à vos messages.

📋 Utilisation des données
Vos données personnelles sont utilisées exclusivement pour : afficher vos annonces, permettre la mise en relation avec les acheteurs, gérer votre compte, envoyer des notifications liées à votre activité sur la plateforme. Elles ne sont jamais vendues ni cédées à des fins commerciales.

📱 Notifications push
Si vous activez les notifications, votre appareil est enregistré pour recevoir des alertes liées à vos conversations et annonces. Vous pouvez désactiver cette option à tout moment dans les paramètres de votre profil.

🗑️ Suppression des données
Vous pouvez demander la suppression de votre compte et de l'ensemble de vos données à tout moment en contactant l'administrateur via WhatsApp. Votre compte et vos annonces seront supprimés dans les meilleurs délais.

En cliquant sur "J'accepte et je continue", vous confirmez avoir lu et accepté la présente politique de confidentialité.`;

const PRIVACY_POLICY_EN = `TogoMarket only collects the information necessary for the platform to function: name, first name, phone number, profile photo, and your listing content.

🔒 Conversation confidentiality
All communications exchanged on TogoMarket (buyer-seller messaging) are transmitted via a secure HTTPS connection (TLS encryption). Access to messages is strictly limited to the participants of each conversation through a secure token system. TogoMarket formally commits to never consulting, monitoring, or disclosing the content of your private conversations. No third party can access your messages.

📋 Use of data
Your personal data is used exclusively for: displaying your listings, enabling contact with buyers, managing your account, and sending notifications related to your activity on the platform. It is never sold or transferred for commercial purposes.

📱 Push notifications
If you enable notifications, your device is registered to receive alerts related to your conversations and listings. You can disable this option at any time in your profile settings.

🗑️ Data deletion
You can request the deletion of your account and all your data at any time by contacting the administrator via WhatsApp. Your account and listings will be deleted as soon as possible.

By clicking "I accept and continue", you confirm that you have read and accepted this privacy policy.`;

export function AuthModal({ open, onOpenChange, onLoginSuccess, referredBy }: AuthModalProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { toast } = useToast();
  const [screen, setScreen] = useState<Screen>("choice");
  const [verifyInfo, setVerifyInfo] = useState<VerifyInfo | null>(null);
  const [pendingRegister, setPendingRegister] = useState<PendingRegister | null>(null);

  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegPwd2, setShowRegPwd2] = useState(false);

  const [regFirstName, setRegFirstName] = useState("");
  const [regLastName, setRegLastName] = useState("");
  const [regShopName, setRegShopName] = useState("");
  const [regProfilePhotoPath, setRegProfilePhotoPath] = useState<string | null>(null);
  const [regProfilePhotoPreview, setRegProfilePhotoPreview] = useState<string | null>(null);
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
  const [regDialCode, setRegDialCode] = useState("228");
  const [regLocalPhone, setRegLocalPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPassword2, setRegPassword2] = useState("");
  const [cguAccepted, setCguAccepted] = useState(false);
  const [wantsNotifications, setWantsNotifications] = useState(true);

  const photoInputRef = useRef<HTMLInputElement>(null);

  const [otpCode, setOtpCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const registerMutation = useVendorRegister();
  const loginMutation = useVendorLogin();
  const verifyOtpMutation = useVendorVerifyOtp();
  const resendOtpMutation = useVendorResendOtp();
  const requestManualActivation = useVendorRequestManualActivation();

  const privacyPolicy = lang === "fr" ? PRIVACY_POLICY_FR : PRIVACY_POLICY_EN;

  const resetAll = () => {
    setScreen("choice");
    setLoginPhone("");
    setLoginPassword("");
    setRegFirstName("");
    setRegLastName("");
    setRegShopName("");
    setRegProfilePhotoPath(null);
    setRegProfilePhotoPreview(null);
    setProfilePhotoUploading(false);
    setRegDialCode("228");
    setRegLocalPhone("");
    setRegPassword("");
    setRegPassword2("");
    setCguAccepted(false);
    setWantsNotifications(true);
    setVerifyInfo(null);
    setPendingRegister(null);
    setOtpCode("");
    setResendCooldown(0);
  };

  const handleProfilePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Preview immédiat
    const preview = URL.createObjectURL(file);
    setRegProfilePhotoPreview(preview);
    setRegProfilePhotoPath(null);
    setProfilePhotoUploading(true);
    try {
      const objectPath = await uploadImageFile(file, file.name);
      setRegProfilePhotoPath(objectPath);
    } catch {
      toast({ title: "Échec de l'envoi de la photo. Réessayez.", variant: "destructive" });
      setRegProfilePhotoPreview(null);
    } finally {
      setProfilePhotoUploading(false);
      // Réinitialiser l'input pour permettre de re-sélectionner le même fichier
      e.target.value = "";
    }
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) resetAll();
    onOpenChange(val);
  };

  const handleLogin = () => {
    if (!loginPhone.trim() || !loginPassword.trim()) {
      toast({ title: t.requiredFields, variant: "destructive" });
      return;
    }
    loginMutation.mutate(
      { data: { phone: loginPhone.trim(), password: loginPassword } },
      {
        onSuccess: (vendor) => {
          toast({
            title: t.welcomeBack(vendor.firstName),
            description: vendor.verified ? t.connectedDesc : t.pendingActivation,
          });
          onLoginSuccess(vendor, loginPassword);
          resetAll();
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: t.loginError, variant: "destructive" });
        },
      }
    );
  };

  const handleRegisterValidate = () => {
    const localDigits = regLocalPhone.replace(/\D/g, "").replace(/^0+/, "");
    const fullPhone = regDialCode + localDigits;
    if (!regFirstName.trim() || !regLastName.trim() || !localDigits || !regPassword.trim()) {
      toast({ title: t.allFieldsRequired, variant: "destructive" });
      return;
    }
    if (regPassword !== regPassword2) {
      toast({ title: t.passwordsDontMatch, variant: "destructive" });
      return;
    }
    if (regPassword.length < 6) {
      toast({ title: t.passwordTooShort, variant: "destructive" });
      return;
    }
    if (!cguAccepted) {
      toast({ title: "Veuillez accepter les CGU et la Politique de Confidentialité", variant: "destructive" });
      return;
    }
    setPendingRegister({
      firstName: regFirstName.trim(),
      lastName: regLastName.trim(),
      shopName: regShopName.trim() || null,
      phone: fullPhone,
      password: regPassword,
      referredBy,
      profilePhoto: regProfilePhotoPath ?? null,
      wantsNotifications,
    });
    setScreen("privacy");
  };

  const handleAcceptPrivacy = () => {
    if (!pendingRegister) return;
    registerMutation.mutate(
      { data: pendingRegister },
      {
        onSuccess: (result) => {
          setVerifyInfo({ phone: result.phone, firstName: result.firstName });
          setOtpCode("");
          setScreen("verify");
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          if (msg.includes("409") || msg.toLowerCase().includes("already") || msg.toLowerCase().includes("inscrit")) {
            toast({ title: t.alreadyRegistered, description: t.loginInstead, variant: "destructive" });
            setScreen("choice");
          } else {
            toast({ title: t.registrationError, variant: "destructive" });
          }
        },
      }
    );
  };

  const handleVerifyOtp = () => {
    if (!verifyInfo || otpCode.trim().length < 4) {
      toast({ title: "Entrez le code reçu sur WhatsApp", variant: "destructive" });
      return;
    }
    verifyOtpMutation.mutate(
      { data: { phone: verifyInfo.phone, code: otpCode.trim() } },
      {
        onSuccess: (vendor) => {
          toast({ title: `Bienvenue ${vendor.firstName} ! 🎉`, description: "Votre compte est activé." });
          onLoginSuccess(vendor, pendingRegister?.password ?? "");
          resetAll();
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          toast({ title: msg || "Code incorrect ou expiré", variant: "destructive" });
        },
      }
    );
  };

  const handleResendOtp = () => {
    if (!verifyInfo || resendCooldown > 0) return;
    resendOtpMutation.mutate(
      { data: { phone: verifyInfo.phone } },
      {
        onSuccess: () => {
          toast({ title: "Nouveau code envoyé sur WhatsApp ✅" });
          setOtpCode("");
          setResendCooldown(30);
          const interval = setInterval(() => {
            setResendCooldown((v) => {
              if (v <= 1) { clearInterval(interval); return 0; }
              return v - 1;
            });
          }, 1000);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          toast({ title: msg || "Erreur d'envoi", variant: "destructive" });
        },
      }
    );
  };

  const screenTitle: Record<Screen, string> = {
    choice: t.vendorAccount,
    login: t.signIn,
    register: t.createAccount,
    privacy: t.privacyPolicy,
    verify: t.phoneVerification,
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{screenTitle[screen]}</DialogTitle>
        </DialogHeader>

        {screen === "choice" && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">{t.authDesc}</p>
            <Button className="w-full h-12 gap-2" onClick={() => setScreen("login")}>
              <LogIn className="w-4 h-4" />
              {t.signIn}
            </Button>
            <Button variant="outline" className="w-full h-12 gap-2" onClick={() => setScreen("register")}>
              <UserPlus className="w-4 h-4" />
              {t.createAccount}
            </Button>
          </div>
        )}

        {screen === "login" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.whatsappNumber}</label>
              <Input
                placeholder="+228 XX XX XX XX"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.password}</label>
              <div className="relative">
                <Input
                  type={showLoginPwd ? "text" : "password"}
                  placeholder={t.yourPassword}
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
            <Button className="w-full" onClick={handleLogin} disabled={loginMutation.isPending}>
              {loginMutation.isPending ? t.signingIn : t.signIn}
            </Button>
            <button
              type="button"
              className="flex items-center justify-center gap-1 text-xs text-primary underline w-full text-center"
              onClick={() => {
                const msg = lang === "fr"
                  ? `Bonjour, j'ai oublié mon mot de passe TogoMarket. Mon numéro : ${loginPhone.trim() || "?"}`
                  : `Hello, I forgot my TogoMarket password. My number: ${loginPhone.trim() || "?"}`;
                openWhatsApp(`https://wa.me/22870703131?text=${encodeURIComponent(msg)}`);
              }}
            >
              <HelpCircle className="w-3 h-3" />
              {t.forgotPassword}
            </button>
            <button className="text-xs text-muted-foreground underline w-full text-center" onClick={() => setScreen("choice")}>
              {t.back}
            </button>
          </div>
        )}

        {screen === "register" && (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t.firstName}</label>
                <Input placeholder="Kofi" value={regFirstName} onChange={(e) => setRegFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t.lastName}</label>
                <Input placeholder="Mensah" value={regLastName} onChange={(e) => setRegLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nom de la boutique</label>
              <Input
                placeholder="Ex: Chez Kofi, Boutique Mode..."
                value={regShopName}
                onChange={(e) => setRegShopName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Facultatif — si vide, votre prénom sera utilisé.</p>
            </div>

            {/* Photo de profil de la boutique */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Photo de la boutique{" "}
                <span className="text-muted-foreground font-normal">(facultatif)</span>
              </label>
              <div className="flex items-center gap-4">
                {/* Avatar circulaire cliquable */}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={profilePhotoUploading}
                  className="w-16 h-16 rounded-full border-2 border-dashed border-border bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 relative active:scale-95 transition-transform"
                >
                  {regProfilePhotoPreview ? (
                    <img
                      src={regProfilePhotoPreview}
                      alt="Aperçu"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera className="w-6 h-6 text-muted-foreground" />
                  )}
                  {profilePhotoUploading && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-full">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  {!regProfilePhotoPreview ? (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="text-sm text-primary underline"
                    >
                      Ajouter une photo
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="text-sm text-primary underline"
                        disabled={profilePhotoUploading}
                      >
                        Changer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRegProfilePhotoPreview(null);
                          setRegProfilePhotoPath(null);
                        }}
                        className="flex items-center gap-1 text-sm text-destructive/70 hover:text-destructive"
                        disabled={profilePhotoUploading}
                      >
                        <X className="w-3 h-3" />
                        Supprimer
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {profilePhotoUploading
                      ? "Envoi en cours…"
                      : "JPG, PNG — visible sur votre boutique"}
                  </p>
                </div>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleProfilePhotoChange}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t.whatsappNumber}</label>
              <div className="flex gap-2">
                {/* Sélecteur de pays */}
                <select
                  value={regDialCode}
                  onChange={(e) => setRegDialCode(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 flex-shrink-0"
                  style={{ width: "auto", minWidth: "7rem" }}
                >
                  {FEDAPAY_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.dialCode}>
                      {c.flag} +{c.dialCode}
                    </option>
                  ))}
                </select>
                {/* Numéro local */}
                <Input
                  type="tel"
                  placeholder="XX XX XX XX"
                  value={regLocalPhone}
                  onChange={(e) => setRegLocalPhone(e.target.value)}
                  className="flex-1"
                />
              </div>
              {(() => {
                const country = FEDAPAY_COUNTRIES.find(c => c.dialCode === regDialCode);
                return (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {country?.name} (+{regDialCode}) — saisissez le numéro sans l'indicatif
                    </p>
                    {country?.hint && (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                        ℹ️ {country.hint}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t.password}</label>
              <div className="relative">
                <Input
                  type={showRegPwd ? "text" : "password"}
                  placeholder={t.minChars}
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
              <label className="text-sm font-medium">{t.confirmPassword}</label>
              <div className="relative">
                <Input
                  type={showRegPwd2 ? "text" : "password"}
                  placeholder={t.repeatPassword}
                  value={regPassword2}
                  onChange={(e) => setRegPassword2(e.target.value)}
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowRegPwd2((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showRegPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground bg-green-50 border border-green-100 rounded-lg p-3">
              🎁 <strong>30 jours d'essai gratuits</strong> — Votre boutique sera active immédiatement !
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={cguAccepted}
                onChange={(e) => setCguAccepted(e.target.checked)}
                className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                En créant mon compte, j'accepte les{" "}
                <a
                  href="/cgu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  Conditions Générales d'Utilisation
                </a>
                , la{" "}
                <a
                  href="https://togomarket.site/privacy.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  Politique de Confidentialité
                </a>
                , et je reconnais que les frais de transaction liés aux paiements FedaPay sont à ma charge.
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={wantsNotifications}
                onChange={(e) => setWantsNotifications(e.target.checked)}
                className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <span className="text-xs text-muted-foreground leading-relaxed">
                🔔 {lang === "fr"
                  ? "Recevoir des notifications push quand un acheteur m'envoie un message (recommandé)"
                  : "Receive push notifications when a buyer sends me a message (recommended)"}
              </span>
            </label>

            <Button className="w-full" onClick={handleRegisterValidate} disabled={!cguAccepted}>
              {t.continue_}
            </Button>
            <button className="text-xs text-muted-foreground underline w-full text-center" onClick={() => setScreen("choice")}>
              {t.back}
            </button>
          </div>
        )}

        {screen === "privacy" && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0" />
              <p className="text-sm font-semibold text-primary">{t.privacyTitle}</p>
            </div>
            <div className="bg-muted rounded-xl p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto">
              {privacyPolicy}
            </div>
            <a
              href="https://togomarket.site/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline w-full text-center block"
            >
              {t.viewFullPrivacy}
            </a>
            <Button
              className="w-full h-12"
              onClick={handleAcceptPrivacy}
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? t.creatingAccount : t.acceptContinue}
            </Button>
            <button
              className="text-xs text-muted-foreground underline w-full text-center"
              onClick={() => setScreen("register")}
            >
              {t.back}
            </button>
          </div>
        )}

        {screen === "verify" && verifyInfo && (
          <div className="space-y-5 pt-2">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg viewBox="0 0 24 24" className="w-8 h-8 fill-green-600" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <h3 className="font-semibold text-lg">Code envoyé sur WhatsApp 📲</h3>
              <p className="text-sm text-muted-foreground">
                Un code de vérification à 6 chiffres a été envoyé au{" "}
                <span className="font-medium text-foreground">+{verifyInfo.phone}</span>.
                <br />Entrez-le ci-dessous pour activer votre compte.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Code de vérification</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") handleVerifyOtp(); }}
                className="w-full border rounded-lg px-4 py-3 text-center text-3xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
            </div>

            <Button
              className="w-full"
              onClick={handleVerifyOtp}
              disabled={verifyOtpMutation.isPending || otpCode.trim().length < 6}
            >
              {verifyOtpMutation.isPending ? "Vérification…" : "Activer mon compte ✓"}
            </Button>

            <div className="text-center">
              <button
                className="text-sm text-muted-foreground underline disabled:opacity-50 disabled:no-underline"
                onClick={handleResendOtp}
                disabled={resendCooldown > 0 || resendOtpMutation.isPending}
              >
                {resendCooldown > 0
                  ? `Renvoyer le code (${resendCooldown}s)`
                  : resendOtpMutation.isPending
                  ? "Envoi en cours…"
                  : "Je n'ai pas reçu le code — Renvoyer"}
              </button>
            </div>

            {/* Activation manuelle via WhatsApp */}
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2">
              <p className="text-xs text-orange-800 font-medium text-center">
                Toujours pas de code ? Demandez une activation manuelle
              </p>
              <p className="text-[11px] text-orange-700 text-center leading-relaxed">
                Cliquez ci-dessous pour envoyer un message WhatsApp à notre équipe. Votre compte sera activé manuellement <strong>sous 24h maximum</strong>.
              </p>
              <a
                href={`https://wa.me/22870703131?text=${encodeURIComponent(
                  `Bonjour, je sollicite l'activation manuelle de mon compte TogoMarket.\n\nNom : ${verifyInfo?.firstName ?? ""}\nTéléphone : +${verifyInfo?.phone ?? ""}\n\nJe n'ai pas reçu mon code OTP de vérification. Merci de m'aider.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (verifyInfo?.phone) {
                    requestManualActivation.mutate(
                      { data: { phone: verifyInfo.phone } },
                      { onError: () => {} }
                    );
                  }
                }}
                className="flex items-center justify-center gap-2 w-full bg-[#25D366] hover:bg-[#1da851] text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Contacter l'équipe TogoMarket sur WhatsApp
              </a>
            </div>

            <button
              className="text-xs text-muted-foreground underline w-full text-center"
              onClick={() => { resetAll(); onOpenChange(false); }}
            >
              {t.close}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
