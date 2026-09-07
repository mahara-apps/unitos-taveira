import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { recordFailedSignInFn, recordSignInFn } from "@/lib/login-audit.functions";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { clearAccessCaches, getCachedPortalAccess } from "@/lib/access-cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const emailSchema = z.string().trim().min(1, "Informe seu email").email("Email inválido").max(255);
const passwordSchema = z
  .string()
  .min(8, "Mínimo de 8 caracteres")
  .max(72, "Máximo de 72 caracteres");

const REMEMBER_PREF_KEY = "unitos:remember-me";

function readRememberPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(REMEMBER_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeRememberPref(value: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_PREF_KEY, value ? "true" : "false");
  } catch {
    /* localStorage indisponível — ignora */
  }
}

const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  rememberMe: z.boolean(),
});

type SignInValues = z.infer<typeof signInSchema>;

export function LoginForm() {
  const [submitting, setSubmitting] = useState(false);
  // Antes da hidratação o React não intercepta o submit: o formulário era
  // enviado nativamente (GET) e as credenciais iam para a URL sem nada
  // acontecer. O botão só libera quando o JS já está ativo.
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const recordSignIn = useServerFn(recordSignInFn);
  const recordFailedSignIn = useServerFn(recordFailedSignInFn);

  function resolveNext(): string {
    if (typeof window === "undefined") return "/dashboard";
    const raw = new URLSearchParams(window.location.search).get("next");
    if (!raw) return "/dashboard";
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
    } catch {
      /* querystring inválida — usa destino padrão */
    }
    return "/dashboard";
  }

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: readRememberPref(),
    },
  });

  useEffect(() => {
    setReady(true);
    // Limpa credenciais que possam ter vazado na URL por um submit nativo.
    const params = new URLSearchParams(window.location.search);
    if (params.has("email") || params.has("password")) {
      const email = params.get("email");
      if (email) signInForm.setValue("email", email);
      params.delete("email");
      params.delete("password");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`,
      );
    }
  }, [signInForm]);


  async function onSignIn(values: SignInValues) {
    setSubmitting(true);
    // Persiste a preferência antes do signIn: o adaptador de storage lê essa
    // flag em runtime para decidir entre localStorage (lembrar) e
    // sessionStorage (sessão só desta aba).
    writeRememberPref(values.rememberMe);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    setSubmitting(false);
    if (error) {
      // Auditoria de acessos: registra a tentativa falha (nunca a senha).
      void recordFailedSignIn({ data: { email: values.email } }).catch(() => null);
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }
    // Registro de acesso — não bloqueia a navegação se falhar.
    void recordSignIn({ data: { provider: "password" } }).catch(() => null);
    toast.success("Bem-vindo de volta");
    // A identidade mudou: o escopo memorizado do usuário anterior não vale mais.
    clearAccessCaches();
    // Contato de cliente vai direto para a área dele — sem passar pela UI
    // interna (que redirecionaria de novo, gerando um pisca).
    const access = await getCachedPortalAccess().catch(() => null);
    const target =
      access?.isPortalUser ? "/area/inicio" : resolveNext();
    await router.invalidate();
    navigate({ to: target, replace: true });
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Bem-vindo de volta
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Entre com os dados de acesso enviados para você.
      </p>

      <Form {...signInForm}>
        <form onSubmit={signInForm.handleSubmit(onSignIn)} className="mt-10 space-y-6">
          <FormField
            control={signInForm.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="voce@empresa.com"
                    autoComplete="email"
                    className="h-12 rounded-xl bg-background transition-shadow focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-primary)_12%,transparent)]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={signInForm.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Senha
                  </FormLabel>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Esqueci minha senha
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-12 rounded-xl bg-background pr-12 transition-shadow focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-primary)_12%,transparent)]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={signInForm.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      id="remember-me"
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                  </FormControl>
                  <label
                    htmlFor="remember-me"
                    className="cursor-pointer select-none text-sm text-muted-foreground"
                  >
                    Lembrar-me
                  </label>
                </div>
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={submitting || !ready}
            className="h-12 w-full rounded-xl text-sm font-semibold shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--color-primary)_60%,transparent)] transition-transform active:scale-[0.99]"
          >
            {submitting || !ready ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {submitting ? "Entrando…" : "Carregando…"}
              </span>
            ) : (
              "Entrar"
            )}

          </Button>
        </form>
      </Form>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Acesso restrito a usuários convidados.
      </p>
    </div>
  );
}

