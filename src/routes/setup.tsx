import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { LoginLogo } from "@/components/brand/login-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { callRpc } from "@/lib/supabase-rpc";

/**
 * Primeira configuração da instalação.
 *
 * Aparece SOMENTE enquanto a instalação não tem nenhum usuário interno. O
 * primeiro usuário criado se torna Super Admin e o workspace único da
 * instalação é criado automaticamente no banco (trigger `handle_new_user`).
 */
export const Route = createFileRoute("/setup")({
  ssr: false,
  component: SetupPage,
  head: () => ({
    meta: [
      { title: "Primeira configuração — Crie o Super Admin" },
      {
        name: "description",
        content:
          "Crie o Super Admin desta instalação para liberar o primeiro acesso e o workspace único.",
      },
      { property: "og:title", content: "Primeira configuração — Crie o Super Admin" },
      {
        property: "og:description",
        content: "Primeiro acesso de uma instalação Unitos recém-provisionada.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type SetupState = { needs_super_admin?: boolean; has_workspace?: boolean } | null;

function SetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await callRpc<SetupState>(supabase, "installation_setup_state");
      if (cancelled) return;
      if (data && data.needs_super_admin === false) {
        navigate({ to: "/login", replace: true });
        return;
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          role: "super_admin",
          workspace_name: workspaceName.trim() || fullName.trim(),
        },
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Super Admin criado. Workspace da instalação disponível.");
    navigate({ to: "/dashboard", replace: true });
  };

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando esta instalação…
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-14">
      <div className="w-full max-w-md space-y-6">
        <LoginLogo />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" /> Crie o Super Admin desta instalação
            </CardTitle>
            <CardDescription>
              Esta instalação está operacional e ainda não tem usuários. O primeiro acesso criado
              aqui se torna Super Admin e recebe o workspace único da instalação.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="setup-name">Seu nome</Label>
                <Input
                  id="setup-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-workspace">Nome do workspace</Label>
                <Input
                  id="setup-workspace"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Ex.: Pitada Digital"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Cada instalação tem exatamente 1 workspace — ele é criado agora e não pode ser
                  trocado depois.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-email">E-mail</Label>
                <Input
                  id="setup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-password">Senha</Label>
                <Input
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Criar Super Admin
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Meta, Resend, Evolution/WhatsApp e IA são configuráveis depois e não bloqueiam o
                uso da instalação.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
