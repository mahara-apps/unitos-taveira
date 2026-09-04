import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { UnitosLogo } from "@/components/brand/unitos-logo";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Recuperar senha — Unitos" },
      {
        name: "description",
        content: "Envie um link seguro para redefinir a senha da sua conta.",
      },
      { property: "og:title", content: "Recuperar senha — Unitos" },
      {
        property: "og:description",
        content: "Envie um link seguro para redefinir a senha da sua conta.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { message: "Informe seu email" })
    .email({ message: "Email inválido" })
    .max(255),
});

type Values = z.infer<typeof schema>;

function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: Values) {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível enviar o email", {
        description: "Tente novamente em instantes.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-muted)_0%,transparent_60%)]"
      />
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <UnitosLogo variant="full" eager className="mb-4 w-[200px] max-w-full" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Recuperar senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Informe o email da sua conta e enviaremos um link seguro.
          </p>
        </div>

        <div
          className={cn(
            "rounded-xl border border-border bg-card p-6 sm:p-8",
            "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-8px_rgba(16,24,40,0.08)]",
          )}
        >
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Verifique seu email</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Se esta conta existir, você receberá as instruções em instantes. Confira também a
                  caixa de spam.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">
                  <ArrowLeft className="h-4 w-4" /> Voltar para o login
                </Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="voce@exemplo.com"
                          autoComplete="email"
                          className="h-11"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="h-11 w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
                    </>
                  ) : (
                    "Enviar link de recuperação"
                  )}
                </Button>
              </form>
            </Form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Lembrou a senha?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
