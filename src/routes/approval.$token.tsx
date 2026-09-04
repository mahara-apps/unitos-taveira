import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/approval/$token")({
  head: () => ({
    meta: [{ title: "Aprovação de conteúdo" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ApprovalPage,
});

type PostPayload = {
  post: {
    id: string;
    title: string;
    copy: string | null;
    format: string | null;
    channels: string[] | null;
    scheduled_at: string | null;
    cover_url: string | null;
    client_briefing: string | null;
    review_status: string | null;
  };
  client: { name: string } | null;
  token: { id: string; expires_at: string | null };
};

function ApprovalPage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");

  const q = useQuery({
    queryKey: ["public-approval", token],
    queryFn: async (): Promise<PostPayload> => {
      const res = await fetch(`/api/public/approval/${token}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
  });

  const act = useMutation({
    mutationFn: async (verb: "approved" | "changes_requested") => {
      const res = await fetch(`/api/public/approval/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verb, comment: comment.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_d, verb) => {
      toast.success(verb === "approved" ? "Aprovado!" : "Ajustes enviados");
      qc.invalidateQueries({ queryKey: ["public-approval", token] });
      setComment("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div>
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Link indisponível</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Este link expirou, foi revogado ou é inválido. Solicite um novo à agência.
          </p>
        </div>
      </div>
    );
  }

  const { post, client } = q.data;
  const alreadyDecided = post.review_status === "approved";

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Aprovação de conteúdo
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {client?.name ?? "Sua marca"}
            </h1>
          </div>
          <Badge variant="outline">{post.format ?? "post"}</Badge>
        </header>

        <article className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-medium">{post.title}</h2>
          {post.scheduled_at ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Agendado para {new Date(post.scheduled_at).toLocaleString("pt-BR")}
            </p>
          ) : null}

          {post.cover_url ? (
            <img
              src={post.cover_url}
              alt=""
              className="mt-4 w-full rounded-md border object-cover"
            />
          ) : null}

          {post.client_briefing ? (
            <section className="mt-5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Briefing
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">{post.client_briefing}</p>
            </section>
          ) : null}

          {post.copy ? (
            <section className="mt-5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Copy
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{post.copy}</p>
            </section>
          ) : null}

          {post.channels?.length ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {post.channels.map((c) => (
                <Badge key={c} variant="secondary" className="text-xs font-normal">
                  {c}
                </Badge>
              ))}
            </div>
          ) : null}
        </article>

        {alreadyDecided ? (
          <div className="mt-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center text-sm text-emerald-700 dark:text-emerald-300">
            Conteúdo aprovado. Obrigado!
          </div>
        ) : (
          <section className="mt-6 rounded-xl border bg-card p-5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Comentário (opcional)
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Deixe observações para a equipe…"
              className="mt-2"
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => act.mutate("changes_requested")}
                disabled={act.isPending}
              >
                {act.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Pedir ajustes
              </Button>
              <Button
                onClick={() => act.mutate("approved")}
                disabled={act.isPending}
                className="bg-emerald-600 hover:bg-emerald-600/90"
              >
                {act.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Aprovar
              </Button>
            </div>
          </section>
        )}

        <footer className="mt-6 text-center text-xs text-muted-foreground">
          Este link é seguro e pessoal. Não compartilhe.
        </footer>
      </div>
    </div>
  );
}
