import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useVerifyAdmin } from "@workspace/api-client-react";
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
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  password: z.string().min(1, "Mot de passe requis"),
});

type FormValues = z.infer<typeof formSchema>;

interface AdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (password: string) => void;
}

export function AdminModal({ open, onOpenChange, onSuccess }: AdminModalProps) {
  const { toast } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "" },
  });

  const verifyAdmin = useVerifyAdmin();

  const onSubmit = (data: FormValues) => {
    verifyAdmin.mutate(
      { data },
      {
        onSuccess: (res) => {
          if (res.success) {
            toast({ title: "Connexion réussie", description: "Mode admin activé." });
            onSuccess(data.password);
            form.reset();
            onOpenChange(false);
          } else {
            form.setError("password", { message: "Mot de passe incorrect" });
          }
        },
        onError: () => {
          form.setError("password", { message: "Erreur lors de la vérification" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Accès Administrateur</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mot de passe</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full" 
              disabled={verifyAdmin.isPending}
            >
              {verifyAdmin.isPending ? "Vérification..." : "Se connecter"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
