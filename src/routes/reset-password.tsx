import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
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

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Definir nova senha — Unitos" },
      {
        name: "description",
        content: "Escolha uma nova senha para acessar sua conta com segurança.",
      },
      { property: "og:title", content: "Definir nova senha — Unitos" },
      {
        property: "og:description",
        content: "Escolha uma nova senha para acessar sua conta com segurança.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

const schema = z
  .object({
    password: z
      .string()
      .min(8, { message: "Mínimo de 8 caracteres" })
      .max(72, { message: "Máximo de 72 caracteres" }),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "As senhas não coincidem",
  });

type Values = z.infer<typeof schema>;

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  useEffect(() => {
    const hash = window.location.hash ?? "";
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const hasRecovery = params.get("type") === "recovery";

    // Se já existe sessão de recovery (após Supabase hidratar), estamos ok.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady("ok");
      else if (!hasRecovery) setReady("invalid");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady("ok");
    });

    // Se não veio nada útil na URL, fecha após um pequeno janelinha.
    const t = window.setTimeout(() => {
      setReady((current) => (current === "checking" ? "invalid" : current));
    }, 1500);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(t);
    };
  }, []);

  async function onSubmit(values: Values) {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) throw error;
      toast.success("Senha atualizada", {
        description: "Faça login com sua nova senha.",
      });
      await supabase.auth.signOut();
      navigate({ to: "/login" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao atualizar senha";
      toast.error("Não foi possível atualizar", { description: message });
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Definir nova senha
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Escolha uma senha forte para proteger sua conta.
          </p>
        </div>

        <div
          className={cn(
            "rounded-xl border border-border bg-card p-6 sm:p-8",
            "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-8px_rgba(16,24,40,0.08)]",
          )}
        >
          {ready === "checking" ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : ready === "invalid" ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Link inválido ou expirado
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Solicite um novo link de recuperação para continuar.
                </p>
              </div>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Solicitar novo link</Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nova senha</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            autoComplete="new-password"
                            className="h-11 pr-10"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmar senha</FormLabel>
                      <FormControl>
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="new-password"
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
                      <Loader2 className="h-4 w-4 animate-spin" /> Salvando...
                    </>
                  ) : (
                    "Salvar nova senha"
                  )}
                </Button>
              </form>
            </Form>
          )}
        </div>
      </div>
    </main>
  );
}
