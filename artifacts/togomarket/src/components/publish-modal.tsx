import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateListing, getGetListingsQueryKey, type VendorProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resizeImageToBlob } from "@/lib/image";
import { uploadImageFile } from "@/lib/upload";
import { UploadCloud, X, Lock, KeyRound, AlertCircle, UserCircle2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PHONE_REGEX = /\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d[\s\-\.]?\d/;

const codeSchema = z.object({
  code: z.string().length(4, "Le code doit comporter 4 chiffres"),
});
type CodeValues = z.infer<typeof codeSchema>;

const formSchema = z.object({
  name: z
    .string()
    .min(3, "Titre trop court")
    .refine((val) => !PHONE_REGEX.test(val), {
      message: "Le titre ne doit pas contenir de numéro de téléphone.",
    }),
  price: z.coerce.number().min(1, "Prix invalide"),
  location: z
    .string()
    .min(2, "Lieu requis")
    .refine((val) => !PHONE_REGEX.test(val), {
      message: "Le quartier/ville ne doit pas contenir de numéro de téléphone.",
    }),
  sector: z.enum(["AgriMarket", "Immobilier", "Automobile", "Divers"]),
});
type FormValues = z.infer<typeof formSchema>;

interface SavedCode {
  code: string;
  endDate: string;
}

function getSavedCode(vendorPhone: string): SavedCode | null {
  try {
    const raw = localStorage.getItem(`togomarket_pub_${vendorPhone}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedCode;
  } catch {
    return null;
  }
}

function saveCode(vendorPhone: string, code: string, endDate: string) {
  try {
    localStorage.setItem(`togomarket_pub_${vendorPhone}`, JSON.stringify({ code, endDate }));
  } catch {}
}

function clearSavedCode(vendorPhone: string) {
  try {
    localStorage.removeItem(`togomarket_pub_${vendorPhone}`);
  } catch {}
}

function isCodeStillValid(saved: SavedCode, publishCode: NonNullable<VendorProfile["publishCode"]>): boolean {
  if (saved.code !== publishCode.code) return false;
  if (new Date(saved.endDate).getTime() !== new Date(publishCode.endDate).getTime()) return false;
  if (new Date(publishCode.endDate) <= new Date()) return false;
  return true;
}

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: VendorProfile | null;
  vendorPassword: string;
  onNeedLogin: () => void;
}

export function PublishModal({ open, onOpenChange, vendor, vendorPassword, onNeedLogin }: PublishModalProps) {
  const [showCode, setShowCode] = useState(false);
  const [screen, setScreen] = useState<"gate" | "code" | "form">("gate");
  const [verifiedCode, setVerifiedCode] = useState("");
  const [images, setImages] = useState<{ dataUrl: string; objectPath: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createListing = useCreateListing();

  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      price: 0,
      location: "",
      sector: "Divers" as const,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (!vendor?.publishCode || !vendor.verified) return;

    const saved = getSavedCode(vendor.phone);
    if (saved && isCodeStillValid(saved, vendor.publishCode)) {
      setVerifiedCode(saved.code);
      setScreen("form");
    } else {
      if (saved) clearSavedCode(vendor.phone);
      setScreen("gate");
    }
  }, [open, vendor]);

  const onVerifyCode = (data: CodeValues) => {
    const activeCode = vendor?.publishCode?.code;
    if (!activeCode || data.code.trim() !== activeCode) {
      codeForm.setError("code", { message: "Code incorrect. Vérifiez votre code de publication." });
      return;
    }
    const code = data.code.trim();
    setVerifiedCode(code);
    if (vendor?.publishCode) {
      saveCode(vendor.phone, code, vendor.publishCode.endDate);
    }
    setScreen("form");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (images.length + files.length > 4) {
      toast({ title: "Maximum 4 images autorisées", variant: "destructive" });
      return;
    }
    setIsProcessing(true);
    try {
      const entries = await Promise.all(
        files.map(async (file) => {
          const { blob, dataUrl } = await resizeImageToBlob(file);
          const objectPath = await uploadImageFile(blob, file.name);
          return { dataUrl, objectPath };
        })
      );
      setImages((prev) => [...prev, ...entries].slice(0, 4));
    } catch {
      toast({ title: "Erreur de traitement d'image", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = (data: FormValues) => {
    if (!vendor) return;
    createListing.mutate(
      {
        data: {
          ...data,
          images: images.map((img) => img.objectPath),
          vendorPhone: vendor.phone,
          vendorPassword,
          vendorPublishCode: verifiedCode,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          toast({
            title: "Annonce soumise !",
            description: "Votre annonce est en attente de validation par l'administrateur.",
          });
          const message = `Nouvelle annonce soumise sur TogoMarket (en attente de validation)\n\nTitre: ${data.name}\nPrix: ${data.price} FCFA\nSecteur: ${data.sector}\nVendeur: ${vendor.firstName} ${vendor.lastName}\nTéléphone: ${vendor.phone}`;
          window.open(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`, "_blank");
          form.reset();
          codeForm.reset();
          setImages([]);
          setScreen("gate");
          setVerifiedCode("");
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "";
          toast({ title: "Erreur lors de la publication", description: msg || undefined, variant: "destructive" });
        },
      }
    );
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setScreen("gate");
      codeForm.reset();
      form.reset();
      setImages([]);
      setVerifiedCode("");
    }
    onOpenChange(val);
  };

  const handleRenewWhatsApp = () => {
    const msg = `Bonjour, je souhaite renouveler mon code de publication TogoMarket.\nNom : ${vendor?.firstName} ${vendor?.lastName}\nNuméro : ${vendor?.phone}\nMontant : 1 000 FCFA`;
    window.open(`https://wa.me/22870703131?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const Gate = () => {
    if (!vendor) {
      return (
        <div className="py-6 text-center space-y-4">
          <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto">
            <UserCircle2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">Connexion requise</p>
            <p className="text-sm text-muted-foreground">Vous devez être connecté pour publier une annonce.</p>
          </div>
          <Button className="w-full" onClick={() => { onOpenChange(false); onNeedLogin(); }}>
            Se connecter / Créer un compte
          </Button>
        </div>
      );
    }

    if (!vendor.verified) {
      return (
        <div className="py-6 text-center space-y-4">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-amber-500" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">Compte en attente</p>
            <p className="text-sm text-muted-foreground">
              Votre compte n'est pas encore activé. Envoyez votre code de vérification sur WhatsApp si ce n'est pas encore fait.
            </p>
          </div>
          <Button
            className="w-full bg-green-500 hover:bg-green-600 text-white"
            onClick={() => window.open("https://wa.me/22870703131?text=Bonjour%2C%20je%20veux%20activer%20mon%20compte%20vendeur%20TogoMarket.", "_blank")}
          >
            Contacter l'administrateur
          </Button>
        </div>
      );
    }

    if (!vendor.publishCode) {
      return (
        <div className="py-6 text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <KeyRound className="w-8 h-8 text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">Code expiré</p>
            <p className="text-sm text-muted-foreground">
              Votre code de publication a expiré. Renouvelez-le pour 1 000 FCFA/mois.
            </p>
          </div>
          <Button className="w-full bg-green-500 hover:bg-green-600 text-white" onClick={handleRenewWhatsApp}>
            Renouveler via WhatsApp — 1 000 FCFA/mois
          </Button>
        </div>
      );
    }

    return (
      <div className="py-4 space-y-4">
        <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
          {vendor.profilePhoto ? (
            <img src={vendor.profilePhoto} alt={vendor.firstName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-primary font-bold text-sm">{vendor.firstName[0]}{vendor.lastName[0]}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{vendor.firstName} {vendor.lastName}</p>
            <p className="text-xs text-muted-foreground">Code valide — {vendor.publishCode.daysLeft} jour(s) restant(s)</p>
          </div>
        </div>
        <Button className="w-full" onClick={() => setScreen("code")}>
          <Lock className="w-4 h-4 mr-2" />
          Publier une annonce
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {screen === "code" ? (
              <><KeyRound className="w-5 h-5" /> Entrez votre code de publication</>
            ) : screen === "form" ? (
              "Vendre un article"
            ) : (
              <><Lock className="w-5 h-5" /> Publier une annonce</>
            )}
          </DialogTitle>
        </DialogHeader>

        {screen === "gate" && <Gate />}

        {screen === "code" && vendor?.publishCode && (
          <div className="pt-2">
            <p className="text-sm text-muted-foreground mb-4">
              Entrez votre code à 4 chiffres pour accéder au formulaire de publication.
            </p>
            <Form {...codeForm}>
              <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
                <FormField
                  control={codeForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <KeyRound className="w-4 h-4" /> Code de publication (4 chiffres)
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showCode ? "text" : "password"}
                            placeholder="• • • •"
                            maxLength={4}
                            className="text-center text-2xl font-mono tracking-widest pr-10"
                            {...field}
                          />
                          <button type="button" onClick={() => setShowCode((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full bg-primary hover:bg-primary/90">
                  Valider
                </Button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline w-full text-center"
                  onClick={() => setScreen("gate")}
                >
                  Retour
                </button>
              </form>
            </Form>
          </div>
        )}

        {screen === "form" && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
                <Lock className="w-3 h-3 flex-shrink-0 mt-0.5" />
                <span>Votre annonce sera visible après validation. <strong>Toute annonce contenant un numéro de téléphone dans le titre ou sur les photos sera automatiquement rejetée.</strong></span>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Titre de l'article</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: iPhone 12 Pro Max" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prix (FCFA)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="150000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sector"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secteur</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Choisir..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="AgriMarket">AgriMarket</SelectItem>
                          <SelectItem value="Immobilier">Immobilier</SelectItem>
                          <SelectItem value="Automobile">Automobile</SelectItem>
                          <SelectItem value="Divers">Divers</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quartier / Ville</FormLabel>
                    <FormControl>
                      <Input placeholder="Lomé, Agoè" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <label className="text-sm font-medium leading-none">Images (Max 4)</label>
                <div className="mt-2 flex flex-wrap gap-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-md overflow-hidden border border-border">
                      <img src={img.dataUrl} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {images.length < 4 && (
                    <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-md cursor-pointer hover:bg-muted/50 transition-colors">
                      <UploadCloud className="w-5 h-5 text-muted-foreground mb-1" />
                      <span className="text-[10px] text-muted-foreground font-medium">Ajouter</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleFileChange}
                        disabled={isProcessing}
                      />
                    </label>
                  )}
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 mt-6"
                disabled={createListing.isPending || isProcessing}
              >
                {createListing.isPending ? "Envoi en cours..." : "Soumettre l'annonce"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
