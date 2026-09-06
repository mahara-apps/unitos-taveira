/**
 * Credenciais de automação DA INSTALAÇÃO (Super Admin).
 *
 * Cada cliente costuma ter banco, deploy e repositório próprios; o token global
 * do MASTER não alcança projetos de outras organizações. Aqui o Super Admin
 * grava as credenciais daquela instalação — sempre cifradas no servidor. A tela
 * nunca recebe valores em claro: só máscara e "configurado".
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  MinusCircle,
  Plug,
  ShieldCheck,
} from "lucide-react";

import {
  adoptInstallationRepositoryFn,
  clearInstallationCredentialsFn,
  getInstallationCredentialsFn,
  getInstallationSecretsFn,
  rotateInstallationSecretFn,
  saveInstallationCredentialsFn,
  testInstallationCredentialsFn,
} from "@/lib/installation/manager.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTimeBr } from "@/lib/timezone";

type Draft = {
  supabaseManagementToken: string;
  vercelToken: string;
  vercelTeamId: string;
  githubToken: string;
};

const EMPTY: Draft = {
  supabaseManagementToken: "",
  vercelToken: "",
  vercelTeamId: "",
  githubToken: "",
};

const FIELDS: {
  key: keyof Draft;
  label: string;
  hint: string;
  secret: boolean;
  placeholder: string;
  link?: { href: string; label: string };
}[] = [
  {
    key: "supabaseManagementToken",
    label: "Token de gestão do banco",
    hint: "Precisa pertencer à organização do banco desta instalação.",
    secret: true,
    placeholder: "sbp_...",
    link: {
      href: "https://supabase.com/dashboard/account/tokens",
      label: "Gerar token no Supabase",
    },
  },
  {
    key: "vercelToken",
    label: "Token de deploy",
    hint: "Usado para variáveis, vínculo do repositório e publicação.",
    secret: true,
    placeholder: "token de deploy",
    link: { href: "https://vercel.com/account/settings/tokens", label: "Gerar token na Vercel" },
  },
  {
    key: "vercelTeamId",
    label: "Equipe de deploy (opcional)",
    hint: "Informe quando o projeto pertence a uma equipe.",
    secret: false,
    placeholder: "team_...",
  },
  {
    key: "githubToken",
    label: "Token do repositório",
    hint: "Publica o código do MASTER no repositório desta instalação.",
    secret: true,
    placeholder: "ghp_...",
    link: {
      href: "https://github.com/settings/personal-access-tokens/new",
      label: "Gerar token no GitHub",
    },
  },
];

export function InstallationCredentialsCard({ installationId }: { installationId: string }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getInstallationCredentialsFn);
  const saveFn = useServerFn(saveInstallationCredentialsFn);
  const clearFn = useServerFn(clearInstallationCredentialsFn);
  const testFn = useServerFn(testInstallationCredentialsFn);
  const adoptFn = useServerFn(adoptInstallationRepositoryFn);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [repoDraft, setRepoDraft] = useState("");


  const status = useQuery({
    queryKey: ["installation-credentials", installationId],
    queryFn: () => statusFn({ data: { id: installationId } }),
    retry: false,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["installation-credentials", installationId] });
    void qc.invalidateQueries({ queryKey: ["installation-automation", installationId] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = { id: installationId };
      for (const field of FIELDS) {
        const value = draft[field.key].trim();
        if (value) payload[field.key] = value;
      }
      return saveFn({ data: payload as never });
    },
    onSuccess: () => {
      setDraft(EMPTY);
      invalidate();
      toast.success("Credenciais desta instalação salvas com segurança.");
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar."),
  });

  const clear = useMutation({
    mutationFn: () => clearFn({ data: { id: installationId } }),
    onSuccess: () => {
      setDraft(EMPTY);
      invalidate();
      toast.success("Credenciais próprias removidas.");
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível remover."),
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { id: installationId } }),
    onSuccess: (result) => {
      const ok = result.database.ok && result.deploy.ok && result.code.ok;
      const detail = `${result.database.detail} · ${result.deploy.detail} · ${result.code.detail}`;
      if (ok) toast.success(detail);
      else toast.error(detail);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível testar."),
  });

  const adopt = useMutation({
    mutationFn: () => adoptFn({ data: { id: installationId, repo: repoDraft.trim() } }),
    onSuccess: (result) => {
      setRepoDraft("");
      invalidate();
      toast.success(`Repositório ${result.repo} adotado na versão ${result.version}.`);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível adotar."),
  });


  const data = status.data;
  const anyConfigured =
    data?.supabaseManagementToken.configured ||
    data?.vercelToken.configured ||
    data?.githubToken.configured;

  return (
    <Card>
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Credenciais desta instalação</span>
        </CardTitle>
        <Badge variant={anyConfigured ? "default" : "outline"} className="shrink-0">
          {anyConfigured ? "Próprias" : "Herdadas do MASTER"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Os valores ficam guardados criptografados e nunca voltam para esta tela. Deixe um campo em
          branco para manter o que já está salvo.
        </p>

        {status.isPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-3">
            {FIELDS.map((field) => {
              const state =
                field.key === "vercelTeamId"
                  ? { configured: Boolean(data?.vercelTeamId), masked: data?.vercelTeamId ?? null }
                  : (data?.[field.key as "supabaseManagementToken"] ?? {
                      configured: false,
                      masked: null,
                    });
              return (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`cred-${field.key}`} className="text-xs">
                      {field.label}
                    </Label>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {state.configured ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-severity-success" />
                          {state.masked ?? "configurado"}
                        </>
                      ) : (
                        <>
                          <MinusCircle className="h-3 w-3" />
                          não configurado
                        </>
                      )}
                    </span>
                  </div>
                  <Input
                    id={`cred-${field.key}`}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    placeholder={field.placeholder}
                    value={draft[field.key]}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {field.hint}
                    {field.link && (
                      <>
                        {" "}
                        <a
                          href={field.link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {field.link.label}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {data?.updatedAt && (
          <p className="text-[11px] text-muted-foreground">
            Última alteração: {formatDateTimeBr(data.updatedAt)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={save.isPending || !FIELDS.some((field) => draft[field.key].trim())}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Salvar credenciais
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plug className="mr-1.5 h-3.5 w-3.5" />
            )}
            Testar acesso
          </Button>
          {anyConfigured && (
            <Button
              size="sm"
              variant="ghost"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
            >
              {clear.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Remover próprias
            </Button>
          )}
        </div>

        <div className="space-y-1.5 rounded-md border border-dashed p-3">
          <Label htmlFor="cred-adopt-repo" className="text-xs">
            Já criou o repositório manualmente?
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="cred-adopt-repo"
              autoComplete="off"
              placeholder="dono/repositorio"
              className="max-w-xs"
              value={repoDraft}
              onChange={(event) => setRepoDraft(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={adopt.isPending || repoDraft.trim().length < 3}
              onClick={() => adopt.mutate()}
            >
              {adopt.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Usar este repositório
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Confere o conteúdo contra a versão do MASTER e marca a etapa de código como concluída,
            sem sobrescrever nada.
          </p>
        </div>

        <InstallationSecretsSection installationId={installationId} />
      </CardContent>
    </Card>
  );
}

/**
 * Chaves internas da instalação. Ficam guardadas e são reaproveitadas em toda
 * atualização; trocar a chave de criptografia obriga a reconectar as redes
 * sociais, então a troca só acontece por clique consciente.
 */
const SECRET_LABELS: Record<string, { label: string; hint: string; warn?: string }> = {
  CRON_SECRET: {
    label: "Chave das rotinas automáticas",
    hint: "Protege as tarefas agendadas da instalação.",
  },
  BRAND_CREDENTIALS_SECRET: {
    label: "Chave de criptografia dos acessos",
    hint: "Protege os acessos das redes sociais guardados no banco.",
    warn: "Ao trocar, todas as contas de redes sociais precisarão ser reconectadas.",
  },
  META_STATE_SECRET: {
    label: "Chave da conexão Meta",
    hint: "Garante a segurança do vai e volta da autorização do Meta.",
  },
  META_WEBHOOK_VERIFY_TOKEN: {
    label: "Token de verificação do Meta",
    hint: "Usado pelo Meta para confirmar os avisos recebidos.",
  },
};

function InstallationSecretsSection({ installationId }: { installationId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(getInstallationSecretsFn);
  const rotateFn = useServerFn(rotateInstallationSecretFn);
  const [pending, setPending] = useState<string | null>(null);

  const secrets = useQuery({
    queryKey: ["installation-secrets", installationId],
    queryFn: () => listFn({ data: { id: installationId } }),
    retry: false,
  });

  const rotate = useMutation({
    mutationFn: (name: string) => rotateFn({ data: { id: installationId, name } }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["installation-secrets", installationId] });
      toast.success(result.applyHint);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível trocar a chave."),
    onSettled: () => setPending(null),
  });

  if (secrets.isError) return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium">Chaves internas da instalação</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Criadas uma única vez e reaproveitadas em toda atualização. Troque apenas se souber o
        impacto.
      </p>
      {secrets.isPending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </div>
      ) : (
        <ul className="space-y-2">
          {(secrets.data ?? []).map((item) => {
            const meta = SECRET_LABELS[item.name] ?? { label: item.name, hint: "" };
            return (
              <li
                key={item.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-t pt-2 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
                  {meta.warn && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">{meta.warn}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {item.configured ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-severity-success" />
                        guardada
                      </>
                    ) : (
                      <>
                        <MinusCircle className="h-3 w-3" />
                        será criada
                      </>
                    )}
                  </span>
                  {item.configured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rotate.isPending}
                      onClick={() => {
                        if (
                          meta.warn &&
                          !window.confirm(`${meta.warn}\n\nDeseja trocar esta chave?`)
                        ) {
                          return;
                        }
                        setPending(item.name);
                        rotate.mutate(item.name);
                      }}
                    >
                      {rotate.isPending && pending === item.name && (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      )}
                      Trocar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
