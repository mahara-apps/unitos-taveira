import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { acceptBrandInvite, previewInvite } from "@/lib/team.functions";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [{ title: "Aceitar convite — Unitos" }, { name: "robots", content: "noindex" }],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const accept = useServerFn(acceptBrandInvite);
  const preview = useServerFn(previewInvite);
  const [status, setStatus] = useState<
    "checking" | "needs_login" | "wrong_email" | "ready" | "accepting" | "done" | "error"
  >("checking");
  const [message, setMessage] = useState<string>("");
  const [brandName, setBrandName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setStatus("needs_login");
        return;
      }
      try {
        const { invite, brand } = await preview({ data: { token } });
        if (!invite) {
          setStatus("error");
          setMessage("Convite não encontrado.");
          return;
        }
        if (invite.accepted_at) {
          setStatus("error");
          setMessage("Este convite já foi aceito.");
          return;
        }
        if (new Date(invite.expires_at) < new Date()) {
          setStatus("error");
          setMessage("Convite expirado.");
          return;
        }
        const currentEmail = (sess.session.user.email ?? "").toLowerCase();
        if (currentEmail !== invite.email.toLowerCase()) {
          setStatus("wrong_email");
          setMessage(`Este convite é para ${invite.email}. Você está logado como ${currentEmail}.`);
          return;
        }
        setBrandName(brand?.name ?? "a marca");
        setStatus("ready");
      } catch (e) {
        setStatus("error");
        setMessage((e as Error).message);
      }
    })();
  }, [token, preview]);

  const doAccept = async () => {
    setStatus("accepting");
    try {
      await accept({ data: { token } });
      setStatus("done");
      toast.success("Convite aceito");
      setTimeout(() => navigate({ to: "/dashboard" }), 900);
    } catch (e) {
      setStatus("error");
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-background">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Convite Unitos</h1>
        {status === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando…
          </div>
        )}
        {status === "needs_login" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Você precisa entrar com a conta convidada para continuar.
            </p>
            <Button asChild className="w-full">
              <Link to="/login" search={{ next: `/invite/${token}` } as never}>
                Entrar
              </Link>
            </Button>
          </div>
        )}
        {status === "wrong_email" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
              <span>{message}</span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.reload();
              }}
            >
              Sair e entrar com outra conta
            </Button>
          </div>
        )}
        {status === "ready" && (
          <div className="space-y-3">
            <p className="text-sm">
              Você foi convidado a entrar em <strong>{brandName}</strong>.
            </p>
            <Button className="w-full" onClick={doAccept}>
              Aceitar convite
            </Button>
          </div>
        )}
        {status === "accepting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Aceitando…
          </div>
        )}
        {status === "done" && (
          <div className="flex items-center gap-2 text-sm text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            Pronto! Redirecionando…
          </div>
        )}
        {status === "error" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <span>{message}</span>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link to="/dashboard">Ir para o painel</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
