import { useState, useRef } from "react";
import {
  useVendorUpdateProfile,
  useVendorUpdateName,
  useVendorChangePassword,
  type VendorProfile,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { resizeImage } from "@/lib/image";
import { UserCircle2, Camera, Eye, EyeOff, LogOut, ShieldCheck, CheckSquare } from "lucide-react";
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

const PRIVACY_POLICY_FR = `TogoMarket collecte et utilise vos informations personnelles (nom, prénom, numéro de téléphone et photo de profil) dans le seul but de gérer votre compte, afficher vos annonces et faciliter la mise en relation avec les acheteurs sur la plateforme.

Vos données ne seront jamais vendues ni partagées avec des tiers à des fins commerciales. Elles sont conservées de manière sécurisée et utilisées uniquement dans le cadre des services TogoMarket. Vous pouvez demander la suppression de votre compte et de vos données à tout moment en contactant l'administrateur via WhatsApp.`;

const PRIVACY_POLICY_EN = `TogoMarket collects and uses your personal information (name, first name, phone number and profile photo) solely for the purpose of managing your account, displaying your listings and facilitating contact with buyers on the platform.

Your data will never be sold or shared with third parties for commercial purposes. It is kept securely and used only within the scope of TogoMarket services. You can request the deletion of your account and data at any time by contacting the administrator via WhatsApp.`;

interface ProfileSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: VendorProfile;
  vendorPassword: string;
  onVendorUpdate: (vendor: VendorProfile, newPassword?: string) => void;
  onLogout: () => void;
}

export function ProfileSettingsModal({
  open,
  onOpenChange,
  vendor,
  vendorPassword,
  onVendorUpdate,
  onLogout,
}: ProfileSettingsModalProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const updateProfile = useVendorUpdateProfile();
  const updateName = useVendorUpdateName();
  const changePassword = useVendorChangePassword();

  const [firstName, setFirstName] = useState(vendor.firstName);
  const [lastName, setLastName] = useState(vendor.lastName);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  const [confirmNameOpen, setConfirmNameOpen] = useState(false);
  const [confirmPwdOpen, setConfirmPwdOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);

  const privacyPolicy = lang === "fr" ? PRIVACY_POLICY_FR : PRIVACY_POLICY_EN;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIsUploadingPhoto(true);
    try {
      const resized = await resizeImage(file);
      updateProfile.mutate(
        { data: { phone: vendor.phone, password: vendorPassword, profilePhoto: resized } },
        {
          onSuccess: (updated) => {
            onVendorUpdate(updated);
            toast({ title: t.photoUpdated });
          },
          onError: () => toast({ title: t.updateError, variant: "destructive" }),
          onSettled: () => setIsUploadingPhoto(false),
        }
      );
    } catch {
      toast({ title: t.imageReadError, variant: "destructive" });
      setIsUploadingPhoto(false);
    }
  };

  const handleSaveName = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: t.nameRequired, variant: "destructive" });
      return;
    }
    updateName.mutate(
      { data: { phone: vendor.phone, password: vendorPassword, firstName: firstName.trim(), lastName: lastName.trim() } },
      {
        onSuccess: (updated) => {
          setConfirmNameOpen(false);
          onVendorUpdate(updated);
          toast({ title: t.nameUpdated });
        },
        onError: () => toast({ title: t.updateError, variant: "destructive" }),
      }
    );
  };

  const handleChangePassword = () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast({ title: t.allFieldsRequired, variant: "destructive" });
      return;
    }
    if (newPwd !== confirmPwd) {
      toast({ title: t.passwordsDontMatch, variant: "destructive" });
      return;
    }
    if (newPwd.length < 6) {
      toast({ title: t.min6Chars, variant: "destructive" });
      return;
    }
    changePassword.mutate(
      { data: { phone: vendor.phone, oldPassword: oldPwd, newPassword: newPwd } },
      {
        onSuccess: () => {
          setConfirmPwdOpen(false);
          onVendorUpdate(vendor, newPwd);
          setOldPwd("");
          setNewPwd("");
          setConfirmPwd("");
          toast({ title: t.passwordChanged });
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          if (msg.includes("401") || msg.toLowerCase().includes("incorrect")) {
            toast({ title: t.oldPasswordWrong, variant: "destructive" });
          } else {
            toast({ title: t.updateError, variant: "destructive" });
          }
          setConfirmPwdOpen(false);
        },
      }
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.profileSettings}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pb-2">
            {/* Photo */}
            <div className="flex flex-col items-center gap-2">
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploadingPhoto}
                className="relative group rounded-full border-2 border-primary/30 overflow-hidden w-20 h-20 hover:border-primary transition-colors disabled:opacity-60"
              >
                {vendor.profilePhoto ? (
                  <img src={vendor.profilePhoto} alt={vendor.firstName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <UserCircle2 className="w-10 h-10 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {isUploadingPhoto ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera className="w-5 h-5 text-white" />
                  )}
                </div>
              </button>
              <p className="text-xs text-muted-foreground">{t.tapToChangePhoto}</p>
            </div>

            {/* Name */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">{t.personalInfo}</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium mb-1 block">{t.firstName}</label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">{t.lastName}</label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">{t.phoneReadonly}</label>
                <Input value={vendor.phone} readOnly className="bg-muted text-muted-foreground" />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (!firstName.trim() || !lastName.trim()) {
                    toast({ title: t.nameRequired, variant: "destructive" });
                    return;
                  }
                  if (firstName.trim() === vendor.firstName && lastName.trim() === vendor.lastName) {
                    toast({ title: t.noChangesDetected });
                    return;
                  }
                  setConfirmNameOpen(true);
                }}
              >
                {t.saveChanges}
              </Button>
            </div>

            {/* Password */}
            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                {t.security}
              </h3>
              <div>
                <label className="text-xs font-medium mb-1 block">{t.oldPassword}</label>
                <div className="relative">
                  <Input
                    type={showOldPwd ? "text" : "password"}
                    value={oldPwd}
                    onChange={(e) => setOldPwd(e.target.value)}
                    className="pr-10"
                    placeholder="••••••"
                  />
                  <button type="button" onClick={() => setShowOldPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showOldPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">{t.newPassword}</label>
                <div className="relative">
                  <Input
                    type={showNewPwd ? "text" : "password"}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    className="pr-10"
                    placeholder={t.minChars}
                  />
                  <button type="button" onClick={() => setShowNewPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">{t.confirmNewPassword}</label>
                <div className="relative">
                  <Input
                    type={showConfirmPwd ? "text" : "password"}
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    className="pr-10"
                    placeholder={t.repeatPassword}
                  />
                  <button type="button" onClick={() => setShowConfirmPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (!oldPwd || !newPwd || !confirmPwd) {
                    toast({ title: t.allFieldsRequired, variant: "destructive" });
                    return;
                  }
                  if (newPwd !== confirmPwd) {
                    toast({ title: t.passwordsDontMatch, variant: "destructive" });
                    return;
                  }
                  if (newPwd.length < 6) {
                    toast({ title: t.min6Chars, variant: "destructive" });
                    return;
                  }
                  setConfirmPwdOpen(true);
                }}
              >
                {t.changePassword}
              </Button>
            </div>

            {/* Privacy Policy */}
            <div className="border-t pt-4">
              <button
                className="flex items-start gap-2 w-full text-left"
                onClick={() => setShowPrivacy(!showPrivacy)}
              >
                <CheckSquare className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span className="text-xs text-muted-foreground underline">{t.privacyAccepted}</span>
              </button>
              {showPrivacy && (
                <div className="mt-2 p-3 bg-muted rounded-lg text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {privacyPolicy}
                  <a
                    href="https://togomarket.site/privacy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block mt-2 text-primary underline"
                  >
                    {t.viewFullPrivacyShort}
                  </a>
                </div>
              )}
            </div>

            {/* Logout */}
            <div className="border-t pt-4">
              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={() => setConfirmLogoutOpen(true)}
              >
                <LogOut className="w-4 h-4" />
                {t.logout}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm name change */}
      <Dialog open={confirmNameOpen} onOpenChange={setConfirmNameOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader><DialogTitle>{t.confirmChangesTitle}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.confirmNameDesc(`${firstName.trim()} ${lastName.trim()}`)}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmNameOpen(false)}>{t.cancel}</Button>
            <Button onClick={handleSaveName} disabled={updateName.isPending}>
              {updateName.isPending ? t.saving : t.confirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm password change */}
      <Dialog open={confirmPwdOpen} onOpenChange={setConfirmPwdOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader><DialogTitle>{t.confirmChangeTitle}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t.confirmPwdDesc}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmPwdOpen(false)}>{t.cancel}</Button>
            <Button onClick={handleChangePassword} disabled={changePassword.isPending}>
              {changePassword.isPending ? t.modifying : t.confirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm logout */}
      <Dialog open={confirmLogoutOpen} onOpenChange={setConfirmLogoutOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader><DialogTitle>{t.logoutTitle}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t.logoutDesc}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmLogoutOpen(false)}>{t.cancel}</Button>
            <Button variant="destructive" onClick={() => { setConfirmLogoutOpen(false); onOpenChange(false); onLogout(); }}>
              {t.logout}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
