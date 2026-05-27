import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateListing, getGetListingsQueryKey, useGetAdminSettings } from "@workspace/api-client-react";
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
import { resizeImage } from "@/lib/image";
import { UploadCloud, X, Lock, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const codeSchema = z.object({
  code: z.string().min(1, "Code requis"),
});
type CodeValues = z.infer<typeof codeSchema>;

const formSchema = z.object({
  name: z.string().min(3, "Titre trop court"),
  price: z.coerce.number().min(1, "Prix invalide"),
  location: z.string().min(2, "Lieu requis"),
  sector: z.enum(["AgriMarket", "Immobilier", "Automobile", "Divers"]),
  phone: z.string().min(8, "Numéro requis"),
});
type FormValues = z.infer<typeof formSchema>;

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishModal({ open, onOpenChange }: PublishModalProps) {
  const [screen, setScreen] = useState<"code" | "form">("code");
  const [verifiedCode, setVerifiedCode] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createListing = useCreateListing();
  const { data: settings } = useGetAdminSettings();

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
      phone: "",
    },
  });

  const onVerifyCode = (data: CodeValues) => {
    const expected = settings?.publishCode ?? "TOGO2026";
    if (data.code.trim() !== expected) {
      codeForm.setError("code", { message: "Code incorrect. Contactez l'administrateur." });
      return;
    }
    setVerifiedCode(data.code.trim());
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
      const newImages = await Promise.all(files.map((file) => resizeImage(file)));
      setImages((prev) => [...prev, ...newImages].slice(0, 4));
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
    createListing.mutate(
      { data: { ...data, images, publishCode: verifiedCode } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          toast({
            title: "Annonce soumise !",
            description: "Votre annonce est en attente de validation par l'administrateur.",
          });
          const message = `Nouvelle annonce soumise sur TogoMarket (en attente de validation)\n\nTitre: ${data.name}\nPrix: ${data.price} FCFA\nSecteur: ${data.sector}\nTéléphone vendeur: ${data.phone}`;
          window.open(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`, "_blank");
          form.reset();
          codeForm.reset();
          setImages([]);
          setScreen("code");
          setVerifiedCode("");
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Erreur lors de la publication", variant: "destructive" });
        },
      }
    );
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setScreen("code");
      codeForm.reset();
      form.reset();
      setImages([]);
      setVerifiedCode("");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {screen === "code" ? (
              <><Lock className="w-5 h-5" /> Accès vendeur</>
            ) : (
              "Vendre un article"
            )}
          </DialogTitle>
        </DialogHeader>

        {screen === "code" ? (
          <div className="pt-2">
            <p className="text-sm text-muted-foreground mb-6">
              Pour publier une annonce, vous devez disposer d'un code d'accès vendeur. Contactez l'administrateur sur WhatsApp pour l'obtenir.
            </p>
            <Form {...codeForm}>
              <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
                <FormField
                  control={codeForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <KeyRound className="w-4 h-4" /> Code d'accès vendeur
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Entrez votre code..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full bg-primary hover:bg-primary/90">
                  Valider le code
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Pas de code ?{" "}
                  <a
                    href="https://wa.me/22870703131?text=Bonjour%2C%20je%20voudrais%20un%20code%20vendeur%20pour%20TogoMarket"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    Demandez-en un sur WhatsApp
                  </a>
                </p>
              </form>
            </Form>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <Lock className="w-3 h-3 flex-shrink-0" />
                Votre annonce sera visible après validation de l'administrateur.
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

              <div className="grid grid-cols-2 gap-4">
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
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Votre Numéro (WhatsApp)</FormLabel>
                      <FormControl>
                        <Input placeholder="+228 XX XX XX XX" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div>
                <label className="text-sm font-medium leading-none">Images (Max 4)</label>
                <div className="mt-2 flex flex-wrap gap-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-md overflow-hidden border border-border">
                      <img src={img} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
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
