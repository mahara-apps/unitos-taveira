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
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { formatDateTimeBr } from "@/lib/timezone";

type Draft = {
  supabaseManagementToken: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  vercelToken: string;
  vercelTeamId: string;
  githubToken: string;
};

const EMPTY: Draft = {
  supabaseManagementToken: "",
  supabasePublishableKey: "",
  supabaseServiceRoleKey: "",
  vercelToken: "",
  vercelTeamId: "",
  githubToken: "",
};

const FIELDS: {
  key: keyof Draft;
  label: string;
  hint: string;
  /** Requisitos concretos da chave: sem eles a etapa correspondente falha. */
  requirements: string[];
  secret: boolean;
  placeholder: string;
  link?: { href: string; label: string };
}[] = [
  {
    key: "supabaseManagementToken",
    label: "Token de gestão do banco",
    hint: "Cria o banco, aplica o schema e lê as chaves do projeto do cliente.",
    requirements: [
      "A conta que gerou o token precisa ser Owner ou Administrator do projeto.",
      "O token precisa permitir ler as chaves de API do projeto.",
      "Sem isso, banco, chaves e schema não são aplicados.",
    ],
    secret: true,
    placeholder: "sbp_...",
    link: {
      href: "https://supabase.com/dashboard/account/tokens",
      label: "Gerar token no Supabase",
    },
  },
  {
    key: "supabasePublishableKey",
    label: "Chave publicável do projeto",
    hint: "Use quando o token de gestão acessa o banco, mas o Supabase não permite revelar as chaves pela API.",
    requirements: [
      "Copie a chave Publishable ou anon em Project Settings → API Keys.",
      "Ela será testada contra a URL do Supabase desta instalação antes de ser salva.",
    ],
    secret: true,
    placeholder: "sb_publishable_... ou JWT anon",
  },
  {
    key: "supabaseServiceRoleKey",
    label: "Chave de serviço do projeto",
    hint: "Necessária para o servidor da instalação acessar tarefas administrativas.",
    requirements: [
      "Copie a chave Secret ou service_role em Project Settings → API Keys.",
      "Nunca use uma chave do MASTER; ela precisa pertencer ao mesmo Project ref desta instalação.",
    ],
    secret: true,
    placeholder: "sb_secret_... ou JWT service_role",
  },
  {
    key: "vercelToken",
    label: "Token de deploy",
    hint: "Usado para variáveis, vínculo do repositório e publicação.",
    requirements: [
      "Gere na conta dona do projeto de publicação.",
      "Precisa permitir criar publicações e alterar variáveis do projeto.",
      "Se o projeto pertence a uma equipe, o sistema tenta localizar essa equipe automaticamente.",
      "Se a equipe não estiver visível para o token, informe o Team ID abaixo.",
    ],
    secret: true,
    placeholder: "token de deploy",
    link: { href: "https://vercel.com/account/settings/tokens", label: "Gerar token na Vercel" },
  },
  {
    key: "vercelTeamId",
    label: "Equipe de deploy (opcional)",
    hint: "Normalmente pode ficar vazio; use quando a localização automática não encontrar o projeto.",
    requirements: [
      "Projeto em conta pessoal: deixe vazio.",
      "Projeto de equipe: use o ID iniciado por team_, não o nome exibido da equipe.",
    ],
    secret: false,
    placeholder: "team_...",
  },
  {
    key: "githubToken",
    label: "Token do repositório",
    hint: "Publica o código do MASTER no repositório desta instalação.",
    requirements: [
      "Token de acesso pessoal com acesso ao dono/organização do repositório desta instalação.",
      'Permissões: Metadados (leitura), Conteúdo (leitura e gravação — "Contents: Read and write") e Fluxos de trabalho (gravação, se houver automações). A conta também precisa poder criar repositórios no destino.',
      "No token fino, marque o repositório desta instalação em “Repository access”: sem ele o GitHub aceita ler e recusa gravar (“Resource not accessible by personal access token”).",

      "Não precisa acessar o repositório do MASTER: a leitura do código usa a credencial do MASTER.",
      "Use um token exclusivo desta instalação — o limite de uso do GitHub é por conta e tokens compartilhados causam a falha “API rate limit exceeded”.",
      "O repositório MASTER precisa estar marcado como Template repository; instalações novas não usam mais repositório vazio nem cópia arquivo por arquivo.",
      "Administração é opcional: sem ela, um repositório técnico antigo fica intacto e a cópia operacional recebe automaticamente outro nome. Não habilite permissão para excluir repositórios.",
    ],
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
  const [checks, setChecks] = useState<
    Array<{ area: string; label: string; ok: boolean; detail: string }>
  >([]);
  const [summary, setSummary] = useState("");
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
      const list = result.checks ?? [];
      setChecks(list);
      setSummary(result.summary ?? "");
      if (result.ok) toast.success("OK — todos os acessos necessários estão liberados.");
      else toast.error(result.summary ?? "Há acessos faltando — veja a lista abaixo.");
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
    data?.supabasePublishableKey.configured ||
    data?.supabaseServiceRoleKey.configured ||
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
                  {field.secret ? (
                    <PasswordInput
                      id={`cred-${field.key}`}
                      autoComplete="off"
                      placeholder={field.placeholder}
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      id={`cred-${field.key}`}
                      type="text"
                      autoComplete="off"
                      placeholder={field.placeholder}
                      value={draft[field.key]}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    />
                  )}
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
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                    {field.requirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
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

        {checks.length > 0 && (
          <div className="space-y-1.5 rounded-md border p-3">
            <p className="text-xs font-medium">Resultado do teste de acesso</p>
            {summary && <p className="text-[11px] text-muted-foreground">{summary}</p>}
            <ul className="space-y-1">
              {checks.map((check) => (
                <li key={`${check.area}-${check.label}`} className="flex gap-1.5 text-[11px]">
                  {check.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-severity-success" />
                  ) : (
                    <MinusCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium">{check.label}:</span>{" "}
                    <span className="text-muted-foreground">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
