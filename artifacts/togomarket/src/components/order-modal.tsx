import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";

const formSchema = z.object({
  lastName: z.string().min(2, "Nom requis"),
  firstName: z.string().min(2, "Prénom requis"),
  phone: z.string().min(8, "Numéro de téléphone invalide"),
  description: z.string().min(10, "Veuillez décrire l'article recherché avec plus de détails"),
});

type FormValues = z.infer<typeof formSchema>;

interface OrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whatsappOrders: string;
}

export function OrderModal({ open, onOpenChange, whatsappOrders }: OrderModalProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lastName: "",
      firstName: "",
      phone: "",
      description: "",
    },
  });

  const createOrder = useCreateOrder();

  const onSubmit = (data: FormValues) => {
    createOrder.mutate(
      { data },
      {
        onSuccess: () => {
          const message = `Bonjour TogoMarket, je cherche à commander un article spécifique.\n\nNom: ${data.firstName} ${data.lastName}\nTéléphone: ${data.phone}\nDescription: ${data.description}`;
          window.open(`https://wa.me/${whatsappOrders}?text=${encodeURIComponent(message)}`, "_blank");
          form.reset();
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Commander un article</DialogTitle>
          <DialogDescription>
            Vous ne trouvez pas ce que vous cherchez ? Décrivez-nous votre besoin et nous nous chargeons de le trouver pour vous.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prénom</FormLabel>
                    <FormControl>
                      <Input placeholder="Jean" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom</FormLabel>
                    <FormControl>
                      <Input placeholder="Dupont" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Téléphone (WhatsApp)</FormLabel>
                  <FormControl>
                    <Input placeholder="+228 XX XX XX XX" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description détaillée de l'article</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Marque, modèle, état, budget approximatif..." 
                      className="resize-none h-24"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full bg-secondary hover:bg-secondary/90 text-white" 
              disabled={createOrder.isPending}
            >
              {createOrder.isPending ? "Envoi en cours..." : "Envoyer ma demande"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
