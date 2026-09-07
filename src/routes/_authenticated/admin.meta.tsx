import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Loader2 } from "lucide-react";

import { getMetaAppSettingsFn, saveMetaAppSettingsFn } from "@/lib/meta/app-config.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/meta")({
  component: AdminMetaAppPage,
});

type AppType = "unitos" | "client";

const OPTIONS: Array<{ value: AppType; title: string; description: string }> = [
  {
    value: "unitos",
    title: "Unitos — App Meta oficial",
    description:
      "Padrão de toda instalação. Usa o App Meta centralizado do Unitos, já revisado e configurado.",
  },
  {
    value: "client",
    title: "Cliente — App Meta próprio",
    description:
      "Esta instalação passa a autorizar contas usando o App Meta do próprio cliente. Não afeta nenhuma outra instalação.",
  },
];

const META_URLS: Array<{ label: string; path: string; hint: string }> = [
  {
    label: "Redirect URI (OAuth)",
    path: "/api/public/meta/callback",
    hint: "Facebook Login → Valid OAuth Redirect URIs",
  },
  {
    label: "Webhook (callback URL)",
    path: "/api/public/meta/webhook",
    hint: "Webhooks → Callback URL (use o Verify Token da instalação)",
  },
  {
    label: "Deauthorize callback",
    path: "/api/public/meta/deauthorize",
    hint: "Configurações do App → Deauthorize Callback URL",
  },
  {
    label: "Data deletion request",
    path: "/api/public/meta/data-deletion",
    hint: "Configurações do App → Data Deletion Request URL",
  },
  {
    label: "Status da exclusão de dados",
    path: "/api/public/meta/deletion-status",
    hint: "Página pública de acompanhamento da exclusão",
  },
];

function UrlRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(url)
              .then(() => toast.success("URL copiada."))
              .catch(() => toast.error("Não foi possível copiar."));
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copiar
        </Button>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{url}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function AdminMetaAppPage() {
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const readFn = useServerFn(getMetaAppSettingsFn);
  const saveFn = useServerFn(saveMetaAppSettingsFn);

  const q = useQuery({ queryKey: ["admin-meta-app"], queryFn: () => readFn(undefined) });

  const [appType, setAppType] = useState<AppType>("unitos");
  const [appId, setAppId] = useState("");
  const [configId, setConfigId] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setAppType(q.data.appType);
    setAppId(q.data.client.appId ?? "");
    setConfigId(q.data.client.businessConfigId ?? "");
    setSecret("");
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          appType,
          appId: appId.trim() || null,
          businessConfigId: configId.trim() || null,
          ...(secret.trim() ? { appSecret: secret.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Configuração do App Meta atualizada.");
      setSecret("");
      void qc.invalidateQueries({ queryKey: ["admin-meta-app"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const data = q.data;
  // Fora do MASTER, o App oficial do Unitos é somente leitura: chega pronto no
  // provisionamento e a instalação só precisa cadastrar as URLs na Meta.
  const officialReadOnly = appType === "unitos" && data ? !data.officialEditable : false;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">App Meta desta instalação</h2>
        <p className="text-sm text-muted-foreground">
          Define qual App Meta o fluxo “Conectar Meta” usa. A escolha vale apenas para esta
          instalação e é exclusiva do Super Admin.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const active = appType === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setAppType(o.value)}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border/60 hover:border-border hover:bg-muted/40",
              )}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{o.title}</span>
                {active && <Check className="h-4 w-4 text-primary" />}
                {o.value === "unitos" && (
                  <Badge variant="outline" className="ml-auto text-[10px] uppercase">
                    padrão
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>
            </button>
          );
        })}
      </div>

      {officialReadOnly ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">App Meta oficial — já configurado</CardTitle>
            <CardDescription>
              As credenciais do App oficial do Unitos vêm resolvidas por padrão nesta instalação e
              não são editáveis aqui. Você só precisa cadastrar as URLs abaixo no App Meta em
              developers.facebook.com.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="App ID em uso" value={data?.effective.appId ?? "—"} />
            <Row
              label="Config ID (Login for Business)"
              value={data?.effective.businessConfigId ?? "—"}
            />
            <Row label="App Secret" value="gerenciado pelo Unitos (nunca exibido)" />
            <Row
              label="Status"
              value={data?.effective.appId ? "pronto para conectar contas" : "pendente no MASTER"}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {appType === "client"
                ? "Credenciais do App do cliente"
                : "Credenciais do App oficial"}
            </CardTitle>
            <CardDescription>
              {appType === "client"
                ? "O App Secret é armazenado cifrado e nunca é exibido de volta."
                : "Se o ambiente já define META_APP_ID/META_APP_SECRET, esses valores têm prioridade. Sem eles, o fluxo “Conectar Meta” usa as credenciais informadas aqui (segredo cifrado). Instalações cliente recebem estes valores automaticamente no provisionamento."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meta-app-id">App ID</Label>
              <Input
                id="meta-app-id"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="1234567890"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meta-app-secret">App Secret</Label>
              <PasswordInput
                id="meta-app-secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={data?.client.hasSecret ? "•••••••• (mantido)" : "App Secret"}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="meta-config-id">Config ID (Facebook Login for Business)</Label>
              <Input
                id="meta-config-id"
                value={configId}
                onChange={(e) => setConfigId(e.target.value)}
                placeholder="Opcional — sem ele o consentimento usa escopos legados"
                autoComplete="off"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">URLs desta instalação</CardTitle>
          <CardDescription>
            {officialReadOnly
              ? "Com o App oficial do Unitos, só o Redirect URI precisa ser adicionado no App Meta. Webhook, deauthorize e exclusão de dados já estão cadastrados no App e são recebidos pelo Unitos MASTER, que repassa os eventos para esta instalação."
              : "Cole estes valores no painel do App Meta (Facebook Login, Webhooks e conformidade)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(officialReadOnly ? META_URLS.filter((u) => u.path.endsWith("/callback")) : META_URLS).map(
            (u) => (
              <UrlRow key={u.path} label={u.label} url={`${origin}${u.path}`} hint={u.hint} />
            ),
          )}
          <UrlRow label="Domínio do app" url={origin} hint="App Domains / URL do site" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Diagnóstico</CardTitle>
          <CardDescription>Somente leitura.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <Row label="Modo salvo" value={data ? data.appType : "—"} />
          <Row
            label="App oficial (Unitos)"
            value={data ? (data.official.configured ? "configurado" : "não configurado") : "—"}
          />
          <Row label="App ID oficial" value={data?.official.appId ?? "—"} />
          <Row label="Config ID oficial" value={data?.official.businessConfigId ?? "—"} />
          <Row label="App ID salvo" value={data?.client.appId ?? "—"} />
          <Row
            label="Segredo salvo"
            value={data?.client.hasSecret ? (data.client.secretMasked ?? "definido") : "—"}
          />
          <Row
            label="Credenciais em uso"
            value={
              data
                ? data.effective.source === "env"
                  ? "ambiente (env)"
                  : data.effective.source === "stored"
                    ? "salvas nesta instalação"
                    : "não configurado"
                : "—"
            }
          />
          <Row label="App ID em uso" value={data?.effective.appId ?? "—"} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending || q.isLoading}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-sm">{value}</span>
    </div>
  );
}
