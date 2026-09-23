import { useState } from "react";
import { openWhatsApp } from "@/lib/whatsapp";
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
import { useSiteSettings } from "@/lib/site-settings";
import { useT } from "@/lib/i18n";

interface OrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whatsappOrders: string;
}

export function OrderModal({ open, onOpenChange, whatsappOrders }: OrderModalProps) {
  const { lang } = useSiteSettings();
  const t = useT(lang);

  const formSchema = z.object({
    lastName: z.string().min(2, t.lastName),
    firstName: z.string().min(2, t.firstName),
    phone: z.string().min(8, t.phoneWhatsapp),
    description: z.string().min(10, t.itemDescription),
  });

  type FormValues = z.infer<typeof formSchema>;

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
          const message = lang === "fr"
            ? `Bonjour TogoMarket, je cherche à commander un article spécifique.\n\nNom: ${data.firstName} ${data.lastName}\nTéléphone: ${data.phone}\nDescription: ${data.description}`
            : `Hello TogoMarket, I want to order a specific item.\n\nName: ${data.firstName} ${data.lastName}\nPhone: ${data.phone}\nDescription: ${data.description}`;
          openWhatsApp(`https://wa.me/${whatsappOrders}?text=${encodeURIComponent(message)}`);
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
          <DialogTitle>{t.orderTitle}</DialogTitle>
          <DialogDescription>{t.orderDesc}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.firstName}</FormLabel>
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
                    <FormLabel>{t.lastName}</FormLabel>
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
                  <FormLabel>{t.phoneWhatsapp}</FormLabel>
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
                  <FormLabel>{t.itemDescription}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t.itemDescPlaceholder}
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
              {createOrder.isPending ? t.sending : t.sendRequest}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
