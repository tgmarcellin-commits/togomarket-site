import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateListing, getGetListingsQueryKey } from "@workspace/api-client-react";
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
import { UploadCloud, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const [images, setImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createListing = useCreateListing();

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
    } catch (err) {
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
      { data: { ...data, images } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          const message = `Nouvel article publié sur TogoMarket!\n\nTitre: ${data.name}\nPrix: ${data.price} FCFA\nSecteur: ${data.sector}\nTéléphone vendeur: ${data.phone}`;
          window.open(`https://wa.me/22870703131?text=${encodeURIComponent(message)}`, "_blank");
          form.reset();
          setImages([]);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vendre un article</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
              <FormLabel>Images (Max 4)</FormLabel>
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
              {createListing.isPending ? "Publication en cours..." : "Publier l'annonce"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
