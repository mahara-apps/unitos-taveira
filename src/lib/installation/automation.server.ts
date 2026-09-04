/**
 * Provisionamento AUTOMATIZADO — execução (server-only).
 *
 * O MASTER usa SOMENTE credenciais de gestão do próprio ambiente
 * (`UNITOS_SUPABASE_MANAGEMENT_TOKEN`, `UNITOS_VERCEL_TOKEN`) para:
 *   1. inspecionar o Supabase de destino e ler as chaves DELE;
 *   2. aplicar o MESMO baseline dos scripts de `supabase/install/`;
 *   3. gerar secrets exclusivos da instalação;
 *   4. gravar as variáveis no projeto de deploy;
 *   5. resolver a URL operacional (domínio definitivo ou URL temporária);
 *   6. agendar cron, inicializar Brain e rodar a verificação final.
 *
 * Regras duras:
 *   - o operador não precisa exportar nada nem rodar Git Bash;
 *   - nenhum secret do MASTER é reutilizado ou enviado ao destino;
 *   - nenhuma etapa pode apontar para o Supabase/domínio do MASTER;
 *   - dependência externa indisponível => BLOCKED com motivo explícito;
 *   - todo texto persistido passa por `sanitize()` (redaction de segredos).
 */

import baseline000 from "../../../supabase/baseline-snapshot/000_extensions.sql?raw";
import baseline001 from "../../../supabase/baseline-snapshot/001_initial_schema.sql?raw";
import baseline005 from "../../../supabase/baseline-snapshot/005_auth_trigger.sql?raw";
import baseline007 from "../../../supabase/baseline-snapshot/007_delta_migrations.sql?raw";
import baseline003 from "../../../supabase/baseline-snapshot/003_storage_buckets.sql?raw";
import baseline006 from "../../../supabase/baseline-snapshot/006_storage_policies.sql?raw";
import baseline004 from "../../../supabase/baseline-snapshot/004_seeds.sql?raw";
import install010 from "../../../supabase/install/010_installation_identity.sql?raw";
import install011 from "../../../supabase/install/011_brain_stats_init.sql?raw";
import install020 from "../../../supabase/install/020_cron.sql?raw";
import verifySql from "../../../supabase/install/verify-installation.sql?raw";

import { runtimeEnv } from "@/lib/runtime-env.server";

import {
  prepareVerificationSql,
  sanitizeBaselineSqlForManagementApi,
  splitSqlStatements,
  stripPsqlMetaCommands,
  summarizeVerificationRows,
} from "./baseline-sql";
import { containsMasterReference } from "./bootstrap-contract";
import {
  GENERATED_SECRET_VARS,
  assertSecretsAreExclusive,
  automationOutcome,
  buildDeployEnvPlan,
  resolveAutomationCapability,
  resolveAutomationTarget,
  resolveInstallationRepo,
  resolveOperationalUrl,

  type AutomationOutcome,
  type GeneratedSecretVar,
} from "./automation-contract";
import { applyProgressReport, finalizeOperation, sanitize, type OperationRow } from "./runner.server";
import {
  MASTER_RELEASE_VERSION,
  VALIDATE_STEPS,
  type CheckState,
  type HealthCheckId,
} from "./manager-contract";

/* --------------------------------------------------------------- utilidades */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Secret aleatório gerado NO provisionamento — nunca herdado do MASTER. */
export function generateInstallationSecret(length = 48): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Substitui as variáveis psql (`:'app_url'`) usadas pelos scripts. */
function bindAppUrl(sql: string, appUrl: string): string {
  const pure = stripPsqlMetaCommands(sql).sql;
  return pure.replace(/:'app_url'/g, sqlLiteral(appUrl)).replace(/:app_url\b/g, sqlLiteral(appUrl));
}

type Fetcher = typeof fetch;

/** GET real na URL operacional: nunca marca frontend ok sem resposta HTTP. */
export async function probeOperationalUrl(
  origin: string,
  fetchImpl?: Fetcher,
): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const doFetch = fetchImpl ?? fetch;
  try {
    const res = await doFetch(origin, { method: "GET", redirect: "follow" });
    if (res.status >= 200 && res.status < 400) {
      return { ok: true, status: res.status, detail: `HTTP ${res.status}` };
    }
    return { ok: false, status: res.status, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, detail: (e as Error).message };
  }
}

/* ------------------------------------------------ Supabase Management API */

/**
 * Reaplica um arquivo do baseline statement por statement, ignorando SOMENTE
 * erros de "objeto já existe". Qualquer outro erro aborta e é reportado.
 */
export async function applyStatementByStatement(
  management: { query: (sql: string) => Promise<{ ok: boolean; rows: unknown[]; error?: string }> },
  sql: string,
  options?: {
    onProgress?: (processed: number, total: number) => Promise<void> | void;
    isCancelled?: () => Promise<boolean>;
    /** Retomada: statements já aplicados numa execução anterior. */
    startIndex?: number;
    /** Limita o trabalho por invocação para caber na janela do Worker. */
    maxStatements?: number;
  },
): Promise<
  | { ok: true; skipped: number; processed: number; total: number; complete: boolean }
  | { ok: false; error?: string; processed?: number; total?: number }
> {
  const statements = splitSqlStatements(sql);
  // Lotes grandes (150 statements) chegaram a ultrapassar a janela real do
  // Worker/Management API: o request era encerrado antes do AbortController e
  // o checkpoint ficava parado exatamente no limite do lote (ex.: 150/264 =
  // 57% no delta). 25 mantém cada chamada curta e deixa um checkpoint fino.
  const batchSize = 25;
  const from = Math.min(Math.max(options?.startIndex ?? 0, 0), statements.length);
  const maxStatements = Math.max(options?.maxStatements ?? batchSize, 1);
  const stopAt = Math.min(statements.length, from + maxStatements);
  let processed = from;

  // Cada statement é protegido no próprio Postgres e os lotes são enviados em
  // poucas chamadas. Assim um objeto duplicado é ignorado isoladamente, mas
  // qualquer erro diferente continua abortando. Isso evita as ~1.800 chamadas
  // sequenciais que excediam a vida do Worker em retomadas parciais.
  for (let start = from; start < stopAt; start += batchSize) {
    if (await options?.isCancelled?.()) {
      return { ok: false, error: "Operação cancelada pelo Super Admin.", processed };
    }
    const batch = statements.slice(start, Math.min(start + batchSize, stopAt));
    const guarded = batch
      .map((statement, index) => {
        let suffix = index;
        let tag = `$unitos_stmt_${suffix}$`;
        while (statement.includes(tag)) {
          suffix += batch.length;
          tag = `$unitos_stmt_${suffix}$`;
        }
        return [
          "DO $unitos_guard$",
          "BEGIN",
          `  EXECUTE ${tag}${statement}${tag};`,
          "EXCEPTION",
          "  WHEN SQLSTATE '42710' OR SQLSTATE '42P07' OR SQLSTATE '42P06'",
          "    OR SQLSTATE '42701' OR SQLSTATE '42723' OR SQLSTATE '23505' THEN NULL;",
          "  WHEN SQLSTATE '42P16' THEN",
          "    IF SQLERRM ILIKE '%multiple primary key%' THEN",
          "      NULL;",
          "    ELSE",
          "      RAISE;",
          "    END IF;",
          "END",
          "$unitos_guard$;",
        ].join("\n");
      })
      .join("\n");
    const result = await management.query(guarded);
    if (!result.ok) return { ok: false, error: result.error, processed };
    processed += batch.length;
    await options?.onProgress?.(processed, statements.length);
  }
  return {
    ok: true,
    skipped: 0,
    processed,
    total: statements.length,
    complete: processed >= statements.length,
  };
}



export type ManagementClient = {
  query: (sql: string) => Promise<{ ok: boolean; rows: unknown[]; error?: string }>;
  keys: () => Promise<{ ok: boolean; publishableKey?: string; serviceRoleKey?: string; error?: string }>;
};

export function createManagementClient(input: {
  token: string;
  projectRef: string;
  fetchImpl?: Fetcher;
}): ManagementClient {
  const doFetch = input.fetchImpl ?? fetch;
  const base = `https://api.supabase.com/v1/projects/${input.projectRef}`;
  const headers = {
    authorization: `Bearer ${input.token}`,
    "content-type": "application/json",
  };

  return {
    async query(sql) {
      const controller = new AbortController();
      // Precisa expirar ANTES do limite do runtime. Um timeout de 60s não
      // ajudava: o isolate podia morrer primeiro e a operação ficava running.
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await doFetch(`${base}/database/query`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: sql }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, rows: [], error: `HTTP ${res.status} ${text.slice(0, 300)}` };
        }
        const body = (await res.json().catch(() => [])) as unknown;
        return { ok: true, rows: Array.isArray(body) ? body : [] };
      } catch (e) {
        const aborted = e instanceof Error && e.name === "AbortError";
        return { ok: false, rows: [], error: aborted ? "timeout de 15s na Management API" : (e as Error).message };
      } finally {
        clearTimeout(timer);
      }
    },
    async keys() {
      try {
        const res = await doFetch(`${base}/api-keys?reveal=true`, { headers });
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ao ler as chaves do Supabase destino` };
        }
        const body = (await res.json().catch(() => [])) as Array<{
          name?: string;
          type?: string;
          api_key?: string;
        }>;
        const find = (name: string) =>
          body.find((k) => k.name === name || k.type === name)?.api_key ?? undefined;
        return {
          ok: true,
          publishableKey: find("anon") ?? find("publishable"),
          serviceRoleKey: find("service_role") ?? find("secret"),
        };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

/* ------------------------------------------------------------- Vercel API */

export type DeployClient = {
  deploymentUrl: () => Promise<{ ok: boolean; url?: string; error?: string }>;
  /** Redeploy da producao — necessario para que as variaveis gravadas valham. */
  redeploy: () => Promise<{ ok: boolean; deploymentId?: string; error?: string }>;
  /**
   * Desliga (ou religa) o build automatico da branch de producao no projeto de
   * deploy. Instalacoes externas NAO podem publicar sozinhas a cada commit no
   * MASTER: elas so avancam quando o Super Admin autoriza uma atualizacao.
   */
  setAutoDeploy: (
    enabled: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Liga o projeto de deploy ao repositório `owner/repo` DA INSTALAÇÃO,
   * substituindo qualquer vínculo anterior. Idempotente.
   */
  linkRepository: (repo: string) => Promise<{ ok: boolean; error?: string }>;
  /** Commit atual da branch de producao do repositorio do MASTER. */
  latestCommit: () => Promise<{ ok: boolean; sha?: string; error?: string }>;

  /**
   * Novo build a partir do repositorio ligado ao projeto. Recebe o commit
   * autorizado (`sha`); sem ele usa o commit atual da branch. Sem repositorio
   * ligado, cai para `redeploy()` — que reaproveita o mesmo snapshot e portanto
   * NAO traz codigo novo (source: "rebuild").
   */
  deployLatestCode: (options?: { sha?: string | null }) => Promise<{
    ok: boolean;
    deploymentId?: string;
    source?: "git" | "rebuild";
    ref?: string;
    error?: string;
  }>;
  deploymentState: (
    id: string,
  ) => Promise<{ ok: boolean; state?: string; url?: string; error?: string }>;

  setEnv: (
    entries: readonly { key: string; value: string; sensitive: boolean }[],
  ) => Promise<{ ok: boolean; applied: number; error?: string }>;
};

/**
 * Repositório de código do MASTER. Toda instalação faz deploy DESTE repositório
 * (uma base de código, N projetos de deploy, cada um com seus próprios envs).
 * Sem isso, o projeto de deploy fica ligado a um repositório próprio parado no
 * commit inicial e "puxar atualização" nunca traz código novo.
 */
export const DEFAULT_MASTER_REPO = "mahara-apps/unitos-master";

/* ------------------------------------------------------------- GitHub API */

export type PublishSnapshotOptions = {
  /** Blobs já copiados (sha do MASTER -> sha no destino), de retomadas. */
  blobMap?: Record<string, string>;
  /** Tempo máximo desta execução; ao esgotar, devolve `partial`. */
  timeBudgetMs?: number;
  onProgress?: (progress: { percent: number; detail: string }) => void | Promise<void>;
  /** Persiste o mapa de blobs a cada lote para permitir retomada. */
  onCheckpoint?: (blobMap: Record<string, string>) => void | Promise<void>;
  /** Só compara: não cria blob, árvore nem commit. Usado na adoção manual. */
  dryRun?: boolean;

};

export type PublishSnapshotResult = {
  ok: boolean;
  /** true quando o orçamento de tempo acabou: retomar continua de onde parou. */
  partial?: boolean;
  commitSha?: string;
  changed?: number;
  error?: string;
};

export type CodeClient = {
  /** Cria (template -> fork -> vazio) ou confirma o repositório da instalação. */
  ensureRepo: () => Promise<{
    ok: boolean;
    created?: boolean;
    /** "template" | "fork" | "blank" | "existing" */
    via?: string;
    error?: string;
  }>;
  /** Commit atual da branch de produção do MASTER — versão a publicar. */
  masterHeadSha: () => Promise<{ ok: boolean; sha?: string; error?: string }>;
  /** Diagnóstico do token: alcance da organização, criação e template. */
  diagnose: () => Promise<{
    ok: boolean;
    detail: string;
    masterIsTemplate?: boolean;
    canCreate?: boolean;
  }>;
  /**
   * Publica no repositório da instalação exatamente a árvore do MASTER no
   * commit informado. Quando os objetos são compartilhados (template/fork), a
   * árvore é montada direto com os SHAs do MASTER — 3 chamadas. Caso contrário
   * copia só o que difere, em paralelo, com checkpoint e orçamento de tempo.
   */
  publishSnapshot: (
    sha: string,
    options?:
      | PublishSnapshotOptions
      | ((progress: { percent: number; detail: string }) => void | Promise<void>),
  ) => Promise<PublishSnapshotResult>;
};


type TreeEntry = { path?: string; mode?: string; type?: string; sha?: string };

/**
 * Cliente GitHub do provisionamento. Publica o código do MASTER no repositório
 * DA INSTALAÇÃO — o MASTER é sempre a origem (template), nunca o destino.
 */
export function createCodeClient(input: {
  token: string;
  owner: string;
  repo: string;
  masterRepo?: string | null;
  branch?: string | null;
  fetchImpl?: Fetcher;
}): CodeClient {
  const doFetch = input.fetchImpl ?? fetch;
  const master = (input.masterRepo ?? "").trim() || DEFAULT_MASTER_REPO;
  const branch = (input.branch ?? "").trim() || "main";
  const target = `${input.owner}/${input.repo}`;
  const headers = {
    authorization: `Bearer ${input.token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "unitos-installation-manager",
  };
  const rawApi = (path: string, init?: RequestInit) =>
    doFetch(`https://api.github.com${path}`, { ...init, headers });

  /**
   * Recuo automático em limite de uso do GitHub (403/429 com Retry-After ou
   * cabeçalho de rate limit esgotado). Nunca espera mais que ~8s por tentativa.
   */
  const api = async (path: string, init?: RequestInit): Promise<Response> => {
    let attempt = 0;
    for (;;) {
      const res = await rawApi(path, init);
      const limited =
        (res.status === 403 || res.status === 429) &&
        (res.headers.get("retry-after") !== null ||
          res.headers.get("x-ratelimit-remaining") === "0");
      if (!limited || attempt >= 2) return res;
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const waitMs = Math.min(8000, Math.max(1000, (retryAfter || 2) * 1000));
      attempt += 1;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  };

  const fail = async (res: Response, what: string) => {
    const text = await res.text().catch(() => "");
    return `HTTP ${res.status} ao ${what} (${text.slice(0, 200)})`;
  };

  const viewerLogin = async () => {
    const viewer = await api(`/user`);
    if (!viewer.ok) return "";
    return ((await viewer.json().catch(() => ({}))) as { login?: string }).login ?? "";
  };

  return {
    async diagnose() {
      try {
        const masterRes = await api(`/repos/${master}`);
        if (!masterRes.ok) {
          return {
            ok: false,
            detail: await fail(masterRes, `ler o repositório do MASTER ${master}`),
          };
        }
        const masterJson = (await masterRes.json().catch(() => ({}))) as {
          is_template?: boolean;
        };
        const ownerRes = await api(`/orgs/${input.owner}`);
        const login = await viewerLogin();
        const isPersonal = login.toLowerCase() === input.owner.trim().toLowerCase();
        const reachesOwner = ownerRes.ok || isPersonal;
        const parts = [
          `MASTER ${master} acessível`,
          masterJson.is_template
            ? "marcado como template (criação rápida disponível)"
            : "NÃO está marcado como template (a criação usará fork ou repositório vazio)",
          reachesOwner
            ? `destino ${input.owner} alcançado`
            : `destino ${input.owner} inacessível com este token`,
        ];
        return {
          ok: reachesOwner,
          detail: parts.join(" · "),
          masterIsTemplate: Boolean(masterJson.is_template),
          canCreate: reachesOwner,
        };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    async ensureRepo() {
      try {
        const existing = await api(`/repos/${target}`);
        if (existing.ok) return { ok: true, created: false, via: "existing" };
        if (existing.status !== 404) {
          return { ok: false, error: await fail(existing, `consultar o repositório ${target}`) };
        }
        // 1ª tentativa: gerar do template do MASTER. Objetos compartilhados =>
        // a publicação da versão termina em segundos.
        const created = await api(`/repos/${master}/generate`, {
          method: "POST",
          body: JSON.stringify({
            owner: input.owner,
            name: input.repo,
            private: true,
            include_all_branches: false,
            description: "Instalação Unitos gerada a partir do MASTER",
          }),
        });
        if (created.ok) return { ok: true, created: true, via: "template" };
        const templateError = await fail(
          created,
          `criar ${target} a partir do template ${master}`,
        );

        // 2ª tentativa: fork do MASTER. Também compartilha objetos, então a
        // publicação continua sendo rápida mesmo sem template.
        const forked = await api(`/repos/${master}/forks`, {
          method: "POST",
          body: JSON.stringify({
            organization: input.owner,
            name: input.repo,
            default_branch_only: true,
          }),
        });
        let forkError = "";
        if (forked.ok || forked.status === 202) {
          // O fork é assíncrono: espera o repositório aparecer.
          for (let i = 0; i < 10; i += 1) {
            const check = await api(`/repos/${target}`);
            if (check.ok) return { ok: true, created: true, via: "fork" };
            await new Promise((r) => setTimeout(r, 1500));
          }
          forkError = `fork de ${master} solicitado, mas ${target} não ficou disponível`;
        } else {
          forkError = await fail(forked, `criar ${target} como fork de ${master}`);
        }

        // 3ª tentativa: repositório vazio; o código do MASTER é publicado
        // arquivo por arquivo (mais lento, com checkpoint e retomada).
        const body = JSON.stringify({
          name: input.repo,
          private: true,
          auto_init: false,
          description: "Instalação Unitos (código publicado a partir do MASTER)",
        });
        const login = await viewerLogin();
        const isPersonal = login.toLowerCase() === input.owner.trim().toLowerCase();
        const blank = isPersonal
          ? await api(`/user/repos`, { method: "POST", body })
          : await api(`/orgs/${input.owner}/repos`, { method: "POST", body });
        if (blank.ok) return { ok: true, created: true, via: "blank" };
        const blankError = await fail(blank, `criar o repositório vazio ${target}`);
        return {
          ok: false,
          error:
            `${templateError}; ${forkError}; ${blankError}. Verifique se o token tem permissão de ` +
            `criação de repositórios (fine-grained: Administration = Read and write ` +
            `na organização ${input.owner}) e se o MASTER está marcado como template.`,
        };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async masterHeadSha() {
      try {
        const res = await api(`/repos/${master}/commits/${branch}`);
        if (!res.ok) return { ok: false, error: await fail(res, "ler o commit do MASTER") };
        const body = (await res.json().catch(() => ({}))) as { sha?: string };
        if (!body.sha) return { ok: false, error: "commit do MASTER não retornado" };
        return { ok: true, sha: body.sha };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async publishSnapshot(sha, options) {
      const opts: PublishSnapshotOptions =
        typeof options === "function" ? { onProgress: options } : (options ?? {});
      const onProgress = opts.onProgress;
      const startedAt = Date.now();
      const budgetMs = opts.timeBudgetMs ?? 0;
      const outOfTime = () => budgetMs > 0 && Date.now() - startedAt > budgetMs;
      const blobMap: Record<string, string> = { ...(opts.blobMap ?? {}) };

      // Throttle: um report por ~2% evita centenas de escritas em repositórios
      // grandes sem perder a sensação de tempo real.
      let lastNotified = -5;
      const notify = async (percent: number, detail: string) => {
        const rounded = Math.max(0, Math.min(99, Math.round(percent)));
        if (rounded < 99 && rounded - lastNotified < 2) return;
        lastNotified = rounded;
        try {
          await onProgress?.({ percent: rounded, detail });
        } catch {
          // progresso é informativo: nunca interrompe a publicação.
        }
      };
      const checkpoint = async () => {
        try {
          await opts.onCheckpoint?.({ ...blobMap });
        } catch {
          // checkpoint é otimização: perder não invalida a publicação.
        }
      };
      try {
        await notify(2, "lendo a árvore do MASTER");
        const tree = async (repo: string, ref: string) => {
          const res = await api(`/repos/${repo}/git/trees/${ref}?recursive=1`);
          if (!res.ok) return { ok: false as const, error: await fail(res, `ler a árvore de ${repo}`) };
          const body = (await res.json().catch(() => ({}))) as { tree?: TreeEntry[] };
          return { ok: true as const, entries: (body.tree ?? []).filter((e) => e.type === "blob") };
        };

        const source = await tree(master, sha);
        if (!source.ok) return { ok: false, error: source.error };

        const readHead = async () => {
          const res = await api(`/repos/${target}/git/ref/heads/${branch}`);
          if (res.ok) {
            const body = (await res.json().catch(() => ({}))) as { object?: { sha?: string } };
            return { ok: true as const, sha: body.object?.sha ?? null };
          }
          if (res.status === 404 || res.status === 409) return { ok: true as const, sha: null };
          return { ok: false as const, error: await fail(res, `ler a branch ${branch} de ${target}`) };
        };

        const first = await readHead();
        if (!first.ok) return { ok: false, error: first.error };
        let parent: string | null = first.sha;

        // Repositório recém-criado sem commits: a API de blobs recusa (409
        // "Git Repository is empty"). Criamos o commit inicial pela API de
        // conteúdo, que é a única que funciona em repositório vazio.
        if (!parent) {
          const seed = await api(`/repos/${target}/contents/README.md`, {
            method: "PUT",
            body: JSON.stringify({
              message: "Unitos: inicializar repositório da instalação",
              content: Buffer.from(
                `# ${input.repo}\n\nInstalação Unitos. Código publicado a partir do MASTER.\n`,
                "utf8",
              ).toString("base64"),
              branch,
            }),
          });
          if (!seed.ok && seed.status !== 422) {
            return { ok: false, error: await fail(seed, `inicializar ${target}`) };
          }
          const again = await readHead();
          if (!again.ok) return { ok: false, error: again.error };
          parent = again.sha;
        }

        const destination = parent ? await tree(target, parent) : { ok: true as const, entries: [] };
        if (!destination.ok) return { ok: false, error: destination.error };

        const current = new Map(destination.entries.map((e) => [e.path ?? "", e.sha ?? ""]));

        const changed = source.entries.filter((e) => current.get(e.path ?? "") !== e.sha);
        const removed = destination.entries
          .filter((e) => !source.entries.some((s) => s.path === e.path))
          .map((e) => e.path ?? "");
        if (!changed.length && !removed.length && parent) {
          return { ok: true, commitSha: parent, changed: 0 };
        }
        if (opts.dryRun) {
          return { ok: true, commitSha: parent ?? undefined, changed: changed.length + removed.length };
        }

        const removalEntries = removed.map((path) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: null,
        }));

        /** Árvore apontando direto para os SHAs do MASTER (template/fork). */
        const sharedEntries = () =>
          changed.map((file) => ({
            path: file.path,
            mode: file.mode ?? "100644",
            type: "blob",
            sha: file.sha,
          }));

        /**
         * Cópia dos blobs para o destino, em paralelo controlado, com
         * checkpoint por lote e orçamento de tempo.
         */
        const copiedEntries = async (): Promise<
          | { ok: true; partial: true; changed: number }
          | { ok: true; entries: Array<Record<string, unknown>> }
          | { ok: false; error: string }
        > => {
          const entries: Array<Record<string, unknown>> = [];
          const pending = changed.filter((f) => !blobMap[f.sha ?? ""]);
          const BATCH = 100;
          const CONCURRENCY = 8;
          let copied = 0;
          for (let i = 0; i < pending.length; i += BATCH) {
            const batch = pending.slice(i, i + BATCH);
            let cursor = 0;
            let batchError: string | null = null;
            const worker = async () => {
              for (;;) {
                const index = cursor;
                cursor += 1;
                const file = batch[index];
                if (!file || batchError) return;
                const blob = await api(`/repos/${master}/git/blobs/${file.sha}`);
                if (!blob.ok) {
                  batchError = await fail(blob, `ler ${file.path} do MASTER`);
                  return;
                }
                const body = (await blob.json().catch(() => ({}))) as {
                  content?: string;
                  encoding?: string;
                };
                const created = await api(`/repos/${target}/git/blobs`, {
                  method: "POST",
                  body: JSON.stringify({
                    content: body.content ?? "",
                    encoding: body.encoding ?? "base64",
                  }),
                });
                if (!created.ok) {
                  batchError = await fail(created, `publicar ${file.path} em ${target}`);
                  return;
                }
                const json = (await created.json().catch(() => ({}))) as { sha?: string };
                if (json.sha) blobMap[file.sha ?? ""] = json.sha;
                copied += 1;
                // 5%–90% da etapa: cópia dos arquivos que diferem.
                await notify(
                  5 + (copied / Math.max(pending.length, 1)) * 85,
                  `${copied}/${pending.length} arquivos publicados`,
                );
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()),
            );
            if (batchError) {
              await checkpoint();
              return { ok: false, error: batchError };
            }
            await checkpoint();
            if (outOfTime() && i + BATCH < pending.length) {
              // Devolve o controle: o watchdog retoma exatamente daqui.
              return { ok: true, partial: true, changed: copied };
            }
          }
          for (const file of changed) {
            const mapped = blobMap[file.sha ?? ""];
            if (!mapped) {
              return { ok: false, error: `blob de ${file.path} não publicado em ${target}` };
            }
            entries.push({
              path: file.path,
              mode: file.mode ?? "100644",
              type: "blob",
              sha: mapped,
            });
          }
          return { ok: true, entries };
        };

        // Caminho rápido: repositório gerado do template ou fork do MASTER já
        // contém os objetos, então a árvore aponta direto para os SHAs do
        // MASTER — 3 chamadas em vez de 2 por arquivo. A checagem usa uma
        // amostra e só vale se TODOS os objetos amostrados existirem.
        const samples = [0, 1, Math.floor(changed.length / 2), changed.length - 1]
          .filter((i, at, all) => i >= 0 && all.indexOf(i) === at)
          .map((i) => changed[i]?.sha)
          .filter((s): s is string => Boolean(s));
        let sharedObjects = samples.length > 0;
        for (const candidate of samples) {
          const check = await api(`/repos/${target}/git/blobs/${candidate}`);
          if (!check.ok) {
            sharedObjects = false;
            break;
          }
        }

        let entries: Array<Record<string, unknown>>;
        if (sharedObjects) {
          await notify(80, `${changed.length} arquivos reaproveitados do MASTER`);
          entries = sharedEntries();
        } else {
          const copied = await copiedEntries();
          if (!copied.ok) return { ok: false, error: copied.error };
          if ("partial" in copied) return copied;
          entries = copied.entries;
        }

        await notify(92, "montando a árvore do repositório");
        const buildTree = async (list: Array<Record<string, unknown>>) =>
          api(`/repos/${target}/git/trees`, {
            method: "POST",
            body: JSON.stringify(
              parent ? { base_tree: parent, tree: [...list, ...removalEntries] } : { tree: [...list, ...removalEntries] },
            ),
          });

        let newTree = await buildTree(entries);
        if (!newTree.ok && sharedObjects && (newTree.status === 422 || newTree.status === 404)) {
          // O repositório não compartilha os objetos do MASTER (fork ainda
          // sincronizando ou repositório criado vazio): copia os blobs.
          await notify(6, "objetos do MASTER indisponíveis; copiando arquivos");
          const copied = await copiedEntries();
          if (!copied.ok) return { ok: false, error: copied.error };
          if ("partial" in copied) return copied;
          entries = copied.entries;
          newTree = await buildTree(entries);
        }
        if (!newTree.ok) return { ok: false, error: await fail(newTree, `montar a árvore de ${target}`) };

        const treeJson = (await newTree.json().catch(() => ({}))) as { sha?: string };

        await notify(96, "criando o commit da versão");
        const commit = await api(`/repos/${target}/git/commits`, {
          method: "POST",
          body: JSON.stringify({
            message: `Unitos: publicar versão do MASTER (${sha.slice(0, 7)})`,
            tree: treeJson.sha,
            parents: parent ? [parent] : [],
          }),
        });
        if (!commit.ok) return { ok: false, error: await fail(commit, `criar o commit em ${target}`) };
        const commitJson = (await commit.json().catch(() => ({}))) as { sha?: string };

        const refPath = `/repos/${target}/git/refs`;
        const update = parent
          ? await api(`${refPath}/heads/${branch}`, {
              method: "PATCH",
              body: JSON.stringify({ sha: commitJson.sha, force: true }),
            })
          : await api(refPath, {
              method: "POST",
              body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitJson.sha }),
            });
        if (!update.ok) {
          return { ok: false, error: await fail(update, `atualizar a branch ${branch} de ${target}`) };
        }
        return { ok: true, commitSha: commitJson.sha, changed: changed.length + removed.length };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}



export function createDeployClient(input: {
  token: string;
  project: string;
  teamId?: string | null;
  /** `org/repo` do código do MASTER; default `DEFAULT_MASTER_REPO`. */
  masterRepo?: string | null;
  /** `owner/repo` DA INSTALAÇÃO — repositório que o deploy realmente constrói. */
  repo?: string | null;
  fetchImpl?: Fetcher;
}): DeployClient {
  const doFetch = input.fetchImpl ?? fetch;
  const team = input.teamId ? `teamId=${encodeURIComponent(input.teamId)}` : "";
  const qs = (extra?: string) => [team, extra].filter(Boolean).join("&");
  const headers = {
    authorization: `Bearer ${input.token}`,
    "content-type": "application/json",
  };
  const project = encodeURIComponent(input.project);
  const masterRepo = (input.masterRepo ?? "").trim() || DEFAULT_MASTER_REPO;
  const targetRepo = (input.repo ?? "").trim() || masterRepo;



  const client: DeployClient = {
    async deploymentUrl() {
      try {
        const res = await doFetch(
          `https://api.vercel.com/v9/projects/${project}?${qs()}`.replace(/\?$/, ""),
          { headers },
        );
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ao consultar o projeto de deploy` };
        }
        const body = (await res.json().catch(() => ({}))) as {
          name?: string;
          alias?: Array<{ domain?: string }>;
          targets?: { production?: { url?: string; alias?: string[] } };
        };
        const production = body.targets?.production;
        const candidate =
          production?.alias?.[0] ??
          production?.url ??
          body.alias?.[0]?.domain ??
          (body.name ? `${body.name}.vercel.app` : undefined);
        if (!candidate) {
          return { ok: false, error: "o deploy ainda não expôs uma URL pública" };
        }
        return { ok: true, url: candidate.startsWith("http") ? candidate : `https://${candidate}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async redeploy() {
      try {
        const list = await doFetch(
          `https://api.vercel.com/v6/deployments?${qs(
            `app=${project}&target=production&limit=1`,
          )}`,
          { headers },
        );
        if (!list.ok) {
          return { ok: false, error: `HTTP ${list.status} ao listar deployments` };
        }
        const body = (await list.json().catch(() => ({}))) as {
          deployments?: Array<{ uid?: string; name?: string }>;
        };
        const latest = body.deployments?.[0];
        if (!latest?.uid) {
          return { ok: false, error: "nenhum deployment de producao encontrado para redeploy" };
        }
        const res = await doFetch(`https://api.vercel.com/v13/deployments?${qs("forceNew=1")}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: latest.name ?? input.project,
            deploymentId: latest.uid,
            target: "production",
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `HTTP ${res.status} ao disparar redeploy (${text.slice(0, 200)})` };
        }
        const created = (await res.json().catch(() => ({}))) as { id?: string; uid?: string };
        return { ok: true, deploymentId: created.id ?? created.uid };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async setAutoDeploy(enabled) {
      try {
        const res = await doFetch(
          `https://api.vercel.com/v9/projects/${project}?${qs()}`.replace(/\?$/, ""),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              git: { deploymentEnabled: { main: enabled, master: enabled } },
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            error: `HTTP ${res.status} ao ajustar o build automático (${text.slice(0, 200)})`,
          };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async linkRepository(repo) {
      const slug = (repo ?? "").trim() || targetRepo;
      try {
        const res = await doFetch(
          `https://api.vercel.com/v9/projects/${project}?${qs()}`.replace(/\?$/, ""),
          { headers },
        );
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ao consultar o projeto de deploy` };
        }
        const body = (await res.json().catch(() => ({}))) as {
          id?: string;
          link?: { repo?: string; org?: string };
        };
        const id = encodeURIComponent(body.id ?? input.project);
        const current = `${body.link?.org ?? ""}/${body.link?.repo ?? ""}`.toLowerCase();
        if (current === slug.toLowerCase()) return { ok: true };
        if (body.link?.repo) {
          await doFetch(`https://api.vercel.com/v9/projects/${id}/link?${qs()}`.replace(/\?$/, ""), {
            method: "DELETE",
            headers,
          });
        }
        const linked = await doFetch(
          `https://api.vercel.com/v10/projects/${id}/link?${qs()}`.replace(/\?$/, ""),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ type: "github", repo: slug, gitBranch: "main" }),
          },
        );
        if (!linked.ok) {
          const text = await linked.text().catch(() => "");
          return {
            ok: false,
            error: `HTTP ${linked.status} ao ligar o projeto ao repositório ${slug} (${text.slice(0, 200)})`,
          };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async latestCommit() {
      try {
        const res = await doFetch(
          `https://api.github.com/repos/${masterRepo}/commits/main`,
          { headers: { accept: "application/vnd.github+json" } },
        );
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ao consultar o commit do MASTER` };
        }
        const body = (await res.json().catch(() => ({}))) as { sha?: string };
        if (!body.sha) return { ok: false, error: "commit do MASTER não retornado" };
        return { ok: true, sha: body.sha };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async deployLatestCode(options) {

      try {
        const readProject = async () => {
          const res = await doFetch(
            `https://api.vercel.com/v9/projects/${project}?${qs()}`.replace(/\?$/, ""),
            { headers },
          );
          if (!res.ok) return null;
          return (await res.json().catch(() => ({}))) as {
            id?: string;
            name?: string;
            link?: {
              type?: string;
              repoId?: number | string;
              repo?: string;
              org?: string;
              productionBranch?: string;
            };
          };
        };

        let body = await readProject();
        if (!body) {
          return { ok: false, error: "não foi possível consultar o projeto de deploy" };
        }

        // O projeto precisa apontar para o repositório DA INSTALAÇÃO (o código
        // do MASTER é publicado nele). Se estiver ligado a outro repositório,
        // religa — é o que faz a atualização realmente trazer código novo.
        const current = `${body.link?.org ?? ""}/${body.link?.repo ?? ""}`.toLowerCase();
        if (current !== targetRepo.toLowerCase()) {
          const relinked = await client.linkRepository(targetRepo);
          if (!relinked.ok) {
            return { ok: false, error: relinked.error };
          }
          body = (await readProject()) ?? body;
        }


        // Instalação externa NUNCA publica sozinha a cada commit no MASTER:
        // o build automático da branch fica desligado e o deploy só acontece
        // aqui, quando o Super Admin autoriza a atualização.
        await client.setAutoDeploy(false);

        const link = body.link;
        const repoId = link?.repoId;
        if (!link?.type || repoId === undefined || repoId === null) {
          const fallback = await client.redeploy();
          return { ...fallback, source: "rebuild" as const };
        }
        const branch = (link.productionBranch ?? "main").trim() || "main";
        const ref = (options?.sha ?? "").trim() || branch;


        const created = await doFetch(`https://api.vercel.com/v13/deployments?${qs("forceNew=1")}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: body.name ?? input.project,
            target: "production",
            gitSource: { type: link.type, repoId: String(repoId), ref },
          }),
        });
        if (!created.ok) {
          const text = await created.text().catch(() => "");
          return {
            ok: false,
            error: `HTTP ${created.status} ao disparar deployment do código (${text.slice(0, 200)})`,
          };
        }
        const json = (await created.json().catch(() => ({}))) as { id?: string; uid?: string };
        return { ok: true, deploymentId: json.id ?? json.uid, source: "git" as const, ref };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async deploymentState(id) {
      try {
        const res = await doFetch(
          `https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}?${qs()}`.replace(
            /\?$/,
            "",
          ),
          { headers },
        );
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ao consultar o deployment` };
        }
        const body = (await res.json().catch(() => ({}))) as { readyState?: string; url?: string };
        return {
          ok: true,
          state: body.readyState ?? undefined,
          url: body.url ? `https://${body.url}` : undefined,
        };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async setEnv(entries) {
      try {
        const res = await doFetch(
          `https://api.vercel.com/v10/projects/${project}/env?${qs("upsert=true")}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(
              entries.map((e) => ({
                key: e.key,
                value: e.value,
                type: e.sensitive ? "encrypted" : "plain",
                target: ["production", "preview", "development"],
              })),
            ),
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            applied: 0,
            error: `HTTP ${res.status} ao gravar variáveis (${text.slice(0, 200)})`,
          };
        }
        return { ok: true, applied: entries.length };
      } catch (e) {
        return { ok: false, applied: 0, error: (e as Error).message };
      }
    },
  };

  return client;
}

/* --------------------------------------------------------------- execução */

export type AutomationInstallation = {
  id: string;
  domain: string | null;
  supabaseUrl: string | null;
  supabaseProjectRef: string | null;
  deployProject: string | null;
  /** Repositório Git DA INSTALAÇÃO (`https://github.com/owner/repo`). */
  gitRepoUrl?: string | null;
};


type Client = { from: (table: string) => unknown };

export type AutomationRunResult = Omit<AutomationOutcome, "result"> & {
  result: AutomationOutcome["result"] | "RUNNING";
  appUrl: string | null;
  urlSource: "custom_domain" | "deploy" | null;
  steps: { id: string; state: CheckState | "done" | "error"; detail: string | null }[];
};

/* ------------------------------------------------- checkpoint do baseline */

/** Marcador de arquivo integralmente aplicado. */
export const DONE = -1;

export type BaselineProgress = Record<string, number>;

/** Janela pequena: cada invocação faz um lote e devolve o controle ao runtime. */
export const BASELINE_STATEMENTS_PER_INVOCATION = 25;

/**
 * Lê o checkpoint da instalação: a última operação (inclusive a atual) que
 * registrou progresso de baseline. Permite retomar sem reaplicar tudo.
 */
export async function readBaselineProgress(
  client: Client,
  installationId: string,
  operation: OperationRow,
): Promise<BaselineProgress> {
  try {
    const db = client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => { limit: (n: number) => Promise<{ data?: { detail?: unknown }[] | null }> };
          };
        };
      };
    };
    const { data } = await db
      .from("installation_operations")
      .select("detail")
      .eq("installation_id", installationId)
      .order("started_at", { ascending: false })
      .limit(5);
    const rows = [{ detail: operation.detail }, ...(data ?? [])];
    for (const row of rows) {
      const raw = (row?.detail as { baselineProgress?: unknown } | null)?.baselineProgress;
      if (raw && typeof raw === "object") {
        const out: BaselineProgress = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
        }
        if (Object.keys(out).length > 0) return out;
      }
    }
  } catch {
    // checkpoint é otimização: falha na leitura só significa aplicar do zero.
  }
  return {};
}

/** Persiste o checkpoint no detalhe da operação (nunca contém secrets). */
export async function saveBaselineProgress(
  client: Client,
  operation: OperationRow,
  progress: BaselineProgress,
): Promise<void> {
  try {
    const db = client as never as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => Promise<unknown>;
        };
      };
    };
    const { data: fresh } = await (client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data?: { detail?: unknown } | null }> };
        };
      };
    })
      .from("installation_operations")
      .select("detail")
      .eq("id", operation.id)
      .maybeSingle();
    await db
      .from("installation_operations")
      .update({
        detail: {
          ...((fresh?.detail ?? operation.detail ?? {}) as Record<string, unknown>),
          baselineProgress: progress,
        },
        last_report_at: new Date().toISOString(),
      })
      .eq("id", operation.id);
  } catch {
    // idem: perder o checkpoint não invalida a operação.
  }
}

/** Checkpoint das fases pós-baseline (nunca contém secrets). */
export type StageProgress = {
  deployDone?: boolean;
  appUrl?: string;
  urlSource?: string;
  frontendOk?: boolean;
  /** Código do MASTER já publicado no repositório da instalação. */
  codeDone?: boolean;
  codeSha?: string;
  codeRepo?: string;
  /** Blobs já copiados na publicação (sha do MASTER -> sha no destino). */
  codeBlobs?: Record<string, string>;
  /** Commit do MASTER que a publicação em andamento está copiando. */
  codeSourceSha?: string;

  /** Deployment de atualização já criado; retomadas apenas consultam este ID. */
  updateDeploymentId?: string;
  updateDeploymentSource?: "git" | "rebuild";
  updateDeploymentRef?: string;
};


export async function readStageProgress(
  client: Client,
  operation: OperationRow,
): Promise<StageProgress> {
  try {
    const { data } = await (client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data?: { detail?: unknown } | null }> };
        };
      };
    })
      .from("installation_operations")
      .select("detail")
      .eq("id", operation.id)
      .maybeSingle();
    const raw = (data?.detail as { stageProgress?: unknown } | null | undefined)?.stageProgress;
    if (raw && typeof raw === "object") return raw as StageProgress;
  } catch {
    // checkpoint é otimização/idempotência: leitura falha => refaz a fase.
  }
  return {};
}

export async function saveStageProgress(
  client: Client,
  operation: OperationRow,
  patch: StageProgress,
): Promise<void> {
  try {
    const { data: fresh } = await (client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data?: { detail?: unknown } | null }> };
        };
      };
    })
      .from("installation_operations")
      .select("detail")
      .eq("id", operation.id)
      .maybeSingle();
    const detail = (fresh?.detail ?? operation.detail ?? {}) as Record<string, unknown>;
    await (client as never as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
      };
    })
      .from("installation_operations")
      .update({
        detail: {
          ...detail,
          stageProgress: { ...((detail.stageProgress ?? {}) as StageProgress), ...patch },
        },
        last_report_at: new Date().toISOString(),
      })
      .eq("id", operation.id);
  } catch {
    // idem.
  }
}

async function report(


  client: Client,
  op: OperationRow,
  step: string,
  state: "running" | "done" | "error",
  detail?: string | null,
  percent?: number | null,
) {
  await applyProgressReport(client as never, op as never, {
    step,
    state,
    detail: detail ?? null,
    percent: percent ?? null,
  }).catch(() => undefined);
}

/**
 * Executa o provisionamento automático completo. Nunca simula sucesso:
 * qualquer dependência ausente encerra a operação como BLOCKED.
 */
export async function runAutomatedProvision(input: {
  client: Client;
  operation: OperationRow;
  installation: AutomationInstallation;
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetcher;
  /** Sobrescrita exclusiva para testes determinísticos ponta a ponta. */
  maxStatementsPerInvocation?: number;
}): Promise<AutomationRunResult> {
  const env = input.env ?? runtimeEnv();
  const { client, operation, installation } = input;
  const failures: string[] = [];
  const blocked: string[] = [];
  const checks: Partial<Record<HealthCheckId, CheckState>> = {};
  const steps: AutomationRunResult["steps"] = [];

  const finish = async (appUrl: string | null, source: "custom_domain" | "deploy" | null) => {
    const outcome = automationOutcome({ blocked, failures });
    await finalizeOperation(client as never, operation as never, {
      ok: outcome.result === "PASS",
      warnings: outcome.result === "PASS" && blocked.length > 0,
      // PASS => a instalação passa a rodar a versão do MASTER, e o status
      // derivado vira "Atualizada" (operacional). Sem isso ficaria em "Atenção".
      version: outcome.result === "PASS" ? MASTER_RELEASE_VERSION : null,
      summary:
        outcome.result === "PASS"
          ? `Provisionamento automático concluído${appUrl ? ` em ${appUrl}` : ""}.`
          : `${outcome.result}: ${outcome.reasons.join(" | ")}`,
      errorKind: outcome.result === "PASS" ? null : outcome.result.toLowerCase(),
      checks: checks as never,
    }).catch(() => undefined);
    return { ...outcome, appUrl, urlSource: source, steps };
  };

  const mark = async (
    id: string,
    state: "running" | "done" | "error",
    detail?: string | null,
    percent?: number | null,
  ) => {
    if (state !== "running") steps.push({ id, state, detail: sanitize(detail ?? null) });
    await report(client, operation, id, state, detail, percent);
  };

  const isCancelled = async () => {
    const db = client as never as {
      from: (table: string) => {
        select: (columns: string) => {
          eq: (column: string, value: string) => {
            maybeSingle: () => Promise<{ data?: { status?: string } | null }>;
          };
        };
      };
    };
    const current = await db
      .from("installation_operations")
      .select("status")
      .eq("id", operation.id)
      .maybeSingle();
    return current.data?.status !== "running" && current.data?.status !== "pending";
  };

  /* 1. credenciais próprias do MASTER */
  const capability = resolveAutomationCapability(env);
  if (!capability.available) {
    blocked.push(...capability.blockedReasons);
    await mark("supabase", "error", capability.blockedReasons.join(" | "));
    checks.configuration = "attention";
    return finish(null, null);
  }

  const target = resolveAutomationTarget(installation);
  if (!target.ok) {
    blocked.push(target.reason);
    await mark("supabase", "error", target.reason);
    return finish(null, null);
  }

  const masterRepo = (env["UNITOS_MASTER_REPO"] ?? "").trim() || null;
  const repo = resolveInstallationRepo({
    gitRepoUrl: installation.gitRepoUrl ?? null,
    masterRepo: masterRepo ?? DEFAULT_MASTER_REPO,
  });
  if (!repo.ok) {
    blocked.push(repo.reason);
    await mark("code", "error", repo.reason);
    checks.configuration = "attention";
    return finish(null, null);
  }

  const managementToken = (env["UNITOS_SUPABASE_MANAGEMENT_TOKEN"] ?? "").trim();
  const deployToken = (env["UNITOS_VERCEL_TOKEN"] ?? "").trim();
  const githubToken = (env["UNITOS_GITHUB_TOKEN"] ?? "").trim();
  const teamId = (env["UNITOS_VERCEL_TEAM_ID"] ?? "").trim() || null;


  const management = createManagementClient({
    token: managementToken,
    projectRef: target.projectRef,
    fetchImpl: input.fetchImpl,
  });
  const code = createCodeClient({
    token: githubToken,
    owner: repo.owner,
    repo: repo.repo,
    masterRepo,
    fetchImpl: input.fetchImpl,
  });
  const deploy = createDeployClient({
    token: deployToken,
    project: target.deployProject,
    teamId,
    masterRepo,
    repo: repo.slug,
    fetchImpl: input.fetchImpl,
  });


  /* 2. Supabase destino: conectividade, plataforma e chaves */
  await mark("supabase", "running");
  const ping = await management.query(
    "select count(*)::int as schemas from information_schema.schemata where schema_name in ('auth','storage','vault')",
  );
  if (!ping.ok) {
    blocked.push(`Supabase destino inacessível com a credencial de gestão: ${ping.error ?? ""}`.trim());
    await mark("supabase", "error", ping.error);
    checks.supabase = "error";
    return finish(null, null);
  }
  const schemas = Number((ping.rows[0] as { schemas?: number } | undefined)?.schemas ?? 0);
  if (schemas < 3) {
    blocked.push("O alvo não é um projeto Supabase completo (auth/storage/vault ausentes).");
    await mark("supabase", "error", "schemas de plataforma ausentes");
    checks.supabase = "error";
    return finish(null, null);
  }

  const keys = await management.keys();
  if (!keys.ok || !keys.publishableKey || !keys.serviceRoleKey) {
    blocked.push(
      `Não foi possível ler as chaves do Supabase destino: ${keys.error ?? "chaves não retornadas"}`,
    );
    await mark("supabase", "error", "chaves do destino indisponíveis");
    checks.supabase = "attention";
    return finish(null, null);
  }
  checks.supabase = "ok";
  await mark("supabase", "done", `projeto ${target.projectRef} acessível`);

  /* 3. código no repositório DA INSTALAÇÃO (gerado do template do MASTER).
   * Sem código publicado o deploy não tem o que construir — por isso esta etapa
   * vem antes de conectar a Vercel, gravar variáveis e preparar o banco. */
  const codeStage = await readStageProgress(client, operation);
  await mark("code", "running");
  if (codeStage.codeDone && codeStage.codeSha) {
    await mark(
      "code",
      "done",
      `código já publicado em ${repo.slug} (${codeStage.codeSha.slice(0, 7)}) — checkpoint`,
    );
  } else {
    const ensured = await code.ensureRepo();
    if (!ensured.ok) {
      blocked.push(`Repositório da instalação indisponível: ${ensured.error ?? ""}`.trim());
      await mark("code", "error", ensured.error ?? "repositório indisponível");
      checks.code = "error";
      return finish(null, null);
    }
    const masterHead = await code.masterHeadSha();
    if (!masterHead.ok || !masterHead.sha) {
      blocked.push(
        `Commit do MASTER não lido para publicar no repositório da instalação: ${
          masterHead.error ?? ""
        }`.trim(),
      );
      await mark("code", "error", "commit do MASTER indisponível");
      checks.code = "error";
      return finish(null, null);
    }
    // Retomada continua do checkpoint: blobs já copiados não são copiados de
    // novo. Se o commit do MASTER mudou, o mapa antigo é descartado.
    const reusableBlobs =
      codeStage.codeSourceSha === masterHead.sha ? (codeStage.codeBlobs ?? {}) : {};
    await saveStageProgress(client, operation, {
      codeSourceSha: masterHead.sha,
      codeBlobs: reusableBlobs,
    });
    const published = await code.publishSnapshot(masterHead.sha, {
      blobMap: reusableBlobs,
      // Janela curta do Worker: ao esgotar, devolve `partial` e o watchdog
      // retoma a MESMA operação exatamente daqui.
      timeBudgetMs: 20_000,
      onProgress: async (p) => {
        await mark("code", "running", p.detail, p.percent);
      },
      onCheckpoint: async (blobMap) => {
        await saveStageProgress(client, operation, {
          codeSourceSha: masterHead.sha,
          codeBlobs: blobMap,
        });
      },
    });
    if (!published.ok) {
      failures.push(`Código não publicado em ${repo.slug}: ${published.error ?? ""}`.trim());
      await mark("code", "error", published.error ?? "publicação falhou");
      checks.code = "error";
      return finish(null, null);
    }
    if (published.partial) {
      await mark(
        "code",
        "running",
        `publicando código em ${repo.slug} — ${published.changed ?? 0} arquivos nesta rodada (continua)`,
      );
      return { result: "RUNNING", reasons: [], appUrl: null, urlSource: null, steps };
    }
    await saveStageProgress(client, operation, {
      codeDone: true,
      codeSha: masterHead.sha,
      codeRepo: repo.slug,
      codeBlobs: {},
    });
    checks.code = "ok";
    await mark(
      "code",
      "done",
      `${
        ensured.created
          ? `repositório criado (${ensured.via ?? "novo"}) e `
          : ""
      }código do MASTER publicado em ${repo.slug} (${masterHead.sha.slice(0, 7)}${
        published.changed !== undefined ? `, ${published.changed} arquivos` : ""
      })`,
    );

  }
  checks.code = checks.code ?? "ok";

  /* 4. deploy conectado ao repositório da instalação, sem auto-deploy por Git */
  await mark("deploy_link", "running");
  const linked = await deploy.linkRepository(repo.slug);
  if (!linked.ok) {
    blocked.push(`Projeto de deploy não ligado a ${repo.slug}: ${linked.error ?? ""}`.trim());
    await mark("deploy_link", "error", linked.error ?? "vínculo do repositório falhou");
    checks.configuration = "attention";
    return finish(null, null);
  }
  // Instalação externa nunca publica sozinha a cada commit: o build automático
  // fica desligado e só o MASTER autoriza novas publicações. Fail-closed: se o
  // desligamento não pode ser confirmado, o provisionamento não segue.
  const autoDeployOff = await deploy.setAutoDeploy(false);
  if (!autoDeployOff.ok) {
    blocked.push(
      `Auto-deploy por Git não pôde ser desligado em ${target.deployProject}: ${
        autoDeployOff.error ?? ""
      }`.trim(),
    );
    await mark("deploy_link", "error", autoDeployOff.error ?? "auto-deploy segue ligado");
    checks.configuration = "attention";
    return finish(null, null);
  }
  await mark("deploy_link", "done", `projeto ligado a ${repo.slug} · auto-deploy por Git desligado`);


  /* 5. baseline do banco — roda DEPOIS de código, deploy conectado e variáveis:
   * sem código publicado e sem URL própria não faz sentido preparar o banco. */
  const runBaselinePhase = async (
    appUrl: string | null,
    urlSource: "custom_domain" | "deploy" | null,
  ): Promise<AutomationRunResult | null> => {
  const baseline: { id: string; label: string; sql: string }[] = [

    { id: "database", label: "000_extensions", sql: baseline000 },
    { id: "database", label: "001_initial_schema", sql: baseline001 },
    { id: "database", label: "005_auth_trigger", sql: baseline005 },
    { id: "database", label: "007_delta_migrations", sql: baseline007 },
    { id: "storage", label: "003_storage_buckets", sql: baseline003 },
    { id: "storage", label: "006_storage_policies", sql: baseline006 },
    { id: "seeds", label: "004_seeds", sql: baseline004 },
  ];

  // Checkpoint: o Worker tem vida limitada. Cada arquivo (e cada lote dentro
  // do arquivo) é registrado, então uma retomada continua de onde parou em vez
  // de reaplicar o baseline inteiro — a causa do travamento em 99%.
  const progress = await readBaselineProgress(client, installation.id, operation);

  // Percentual da ETAPA considera todos os arquivos do grupo (ex.: "database"
  // tem 4 arquivos), então a barra da etapa reflete o avanço real.
  const groupTotals = baseline.reduce<Record<string, number>>((acc, f) => {
    acc[f.id] = (acc[f.id] ?? 0) + 1;
    return acc;
  }, {});
  const groupDone: Record<string, number> = {};
  const groupPercent = (id: string, fileFraction: number) =>
    Math.min(
      99,
      Math.round((((groupDone[id] ?? 0) + fileFraction) / Math.max(groupTotals[id] ?? 1, 1)) * 100),
    );

  let currentGroup = "";
  for (const file of baseline) {
    if (file.id !== currentGroup) {
      currentGroup = file.id;
      await mark(file.id, "running", null, groupPercent(file.id, 0));
    }
    if (progress[file.label] === DONE) {
      groupDone[file.id] = (groupDone[file.id] ?? 0) + 1;
      await mark(
        file.id,
        "running",
        `${file.label}: já aplicado (checkpoint)`,
        groupPercent(file.id, 0),
      );
      continue;
    }
    await mark(file.id, "running", `${file.label}: aplicando`, groupPercent(file.id, 0));
    // A Management API executa como `postgres` (não superusuário): comandos
    // exclusivos de superusuário do dump são removidos antes de enviar.
    const prepared = sanitizeBaselineSqlForManagementApi(file.sql);
    const alreadyApplied = progress[file.label] ?? 0;
    // Nunca envie o arquivo inteiro em uma única chamada. Além de não gerar
    // heartbeat durante sua execução, 001 (530 KB) e 007 podiam exceder a vida
    // do runtime. O mesmo caminho curto/idempotente vale para primeira execução
    // e retomada, portanto todos os arquivos do instalador ficam protegidos.
    const perStatement = await applyStatementByStatement(management, prepared.sql, {
      isCancelled,
      startIndex: alreadyApplied,
      maxStatements: BASELINE_STATEMENTS_PER_INVOCATION,
      ...(input.maxStatementsPerInvocation !== undefined
        ? { maxStatements: input.maxStatementsPerInvocation }
        : {}),
      onProgress: async (processed, total) => {
        progress[file.label] = processed;
        await saveBaselineProgress(client, operation, progress);
        const percent = Math.min(99, Math.round((processed / Math.max(total, 1)) * 100));
        const action = alreadyApplied > 0 ? "retomando aplicação" : "aplicando";
        await mark(
          file.id,
          "running",
          `${file.label}: ${action} (${percent}%)`,
          groupPercent(file.id, percent / 100),
        );
      },
    });
    if (!perStatement.ok) {
      if (typeof perStatement.processed === "number" && perStatement.processed > 0) {
        progress[file.label] = perStatement.processed;
        await saveBaselineProgress(client, operation, progress);
      }
      failures.push(`${file.label}: ${perStatement.error ?? "falha ao aplicar"}`);
      await mark(file.id, "error", `${file.label} falhou`);
      checks[file.id === "seeds" ? "database" : (file.id as HealthCheckId)] = "error";
      return finish(appUrl, urlSource);

    }
    if (!perStatement.complete) {
      // Não mantenha uma única Promise viva por centenas de requests: o
      // waitUntil do Worker tem uma janela curta e cancela a tarefa. O
      // checkpoint/heartbeat já foi persistido; o watchdog inicia a próxima
      // invocação, exatamente no statement seguinte, sem concorrência.
      return {
        result: "RUNNING",
        reasons: [],
        appUrl,
        urlSource,
        steps,
      };

    }
    progress[file.label] = DONE;
    groupDone[file.id] = (groupDone[file.id] ?? 0) + 1;
    await saveBaselineProgress(client, operation, progress);

  }
  // O PostgREST mantém um cache do schema. Sem recarregar, todas as tabelas e
  // funções recém-criadas respondem PGRST205/PGRST202 ("Could not find the
  // table ... in the schema cache") e a instalação sobe aparentemente vazia.
  await management.query("NOTIFY pgrst, 'reload schema';");

  checks.database = "ok";

  checks.storage = "ok";
  await mark("database", "done", "baseline aplicado no destino");
  await mark("storage", "done", "buckets e policies aplicados");
  await mark("seeds", "done", "seeds de catálogo aplicados");
  return null;
  };



  /* 4 + 5. secrets exclusivos, URL operacional e variáveis do deploy.
   * Fase atômica com checkpoint: uma retomada NÃO regera secrets nem
   * reconfigura/republica o deploy quando a fase já foi concluída. */
  const stage = await readStageProgress(client, operation);
  let url: { origin: string; source: "custom_domain" | "deploy" };

  if (stage.deployDone && typeof stage.appUrl === "string" && stage.appUrl.length > 0) {
    url = {
      origin: stage.appUrl,
      source: stage.urlSource === "custom_domain" ? "custom_domain" : "deploy",
    };
    checks.secrets = "ok";
    checks.configuration = "ok";
    checks.frontend = stage.frontendOk ? "ok" : "attention";
    await mark("secrets", "done", "secrets próprios já gerados nesta operação (checkpoint)");
    await mark(
      "deploy",
      "done",
      `URL operacional ${url.origin} — variáveis e deployment já aplicados (checkpoint)`,
    );
  } else {
    await mark("secrets", "running");
    const secrets = {} as Record<GeneratedSecretVar, string>;
    for (const name of GENERATED_SECRET_VARS) secrets[name] = generateInstallationSecret();
    const isolation = assertSecretsAreExclusive({ generated: secrets, masterEnv: env });
    if (!isolation.ok) {
      failures.push(isolation.reason);
      await mark("secrets", "error", isolation.reason);
      checks.secrets = "error";
      return finish(null, null);
    }
    const vault = await management.query(
      `select public.set_cron_secret(${sqlLiteral(secrets.CRON_SECRET)});`,
    );
    if (!vault.ok) {
      failures.push(`CRON_SECRET não gravado no Vault do destino: ${vault.error ?? ""}`.trim());
      await mark("secrets", "error", "set_cron_secret falhou");
      checks.secrets = "error";
      return finish(null, null);
    }
    checks.secrets = "ok";
    await mark("secrets", "done", "secrets próprios gerados (valores nunca exibidos)");

    await mark("deploy", "running");
    const deployment = await deploy.deploymentUrl();
    const resolved = resolveOperationalUrl({
      customDomain: installation.domain,
      deploymentUrl: deployment.url ?? null,
    });
    if (!resolved.ok) {
      blocked.push(
        `URL operacional indisponível: ${resolved.reason}${
          deployment.error ? ` (${deployment.error})` : ""
        }`,
      );
      await mark("deploy", "error", resolved.reason);
      checks.frontend = "error";
      return finish(null, null);
    }
    if (containsMasterReference(resolved.origin)) {
      failures.push("A URL resolvida aponta para o MASTER — operação recusada.");
      await mark("deploy", "error", "URL do MASTER recusada");
      return finish(null, null);
    }
    url = { origin: resolved.origin, source: resolved.source };

    // App Meta oficial do Unitos: propagado do MASTER para a instalação nova,
    // de modo que o modo padrão “Unitos — App Meta oficial” já venha resolvido.
    // Falha aqui NÃO bloqueia: a instalação segue operacional e o Super Admin
    // resolve o Meta depois.
    let officialMetaApp: {
      appId?: string | null;
      appSecret?: string | null;
      businessConfigId?: string | null;
    } | null = null;
    try {
      const { resolveMetaAppCredentials, resolveMetaBusinessConfigId } = await import(
        "@/lib/meta/app-config.server"
      );
      const creds = await resolveMetaAppCredentials();
      if (creds.appType === "unitos" && creds.appId && creds.appSecret) {
        officialMetaApp = {
          appId: creds.appId,
          appSecret: creds.appSecret,
          businessConfigId: creds.businessConfigId ?? (await resolveMetaBusinessConfigId()),
        };
      }
    } catch {
      officialMetaApp = null;
    }

    const plan = buildDeployEnvPlan({
      appUrl: url.origin,
      supabaseUrl: installation.supabaseUrl ?? `https://${target.projectRef}.supabase.co`,
      publishableKey: keys.publishableKey,
      serviceRoleKey: keys.serviceRoleKey,
      projectRef: target.projectRef,
      secrets,
      officialMetaApp,
    });
    if (!plan.ok) {
      failures.push(plan.reason);
      await mark("deploy", "error", plan.reason);
      return finish(url.origin, url.source);
    }
    // Instalação externa não pode republicar sozinha a cada commit no MASTER:
    // desliga o build automático da branch já no provisionamento.
    await deploy.setAutoDeploy(false);
    const envResult = await deploy.setEnv(plan.entries);

    if (!envResult.ok) {
      blocked.push(`Variáveis do deploy não configuradas: ${envResult.error ?? ""}`.trim());
      await mark("deploy", "error", "falha ao gravar variáveis do deploy");
      checks.configuration = "attention";
      return finish(url.origin, url.source);
    }

    const identity = await management.query(bindAppUrl(install010, url.origin));
    if (!identity.ok) {
      failures.push(`installation.app_url não registrada: ${identity.error ?? ""}`.trim());
      await mark("deploy", "error", "identidade da instalação inválida");
      return finish(url.origin, url.source);
    }
    checks.configuration = "ok";

    // Gravar variaveis NAO republica o app: sem um novo deployment o frontend
    // continua rodando com o env antigo. O redeploy e disparado aqui — uma
    // única vez por operação, garantido pelo checkpoint abaixo.
    const redeployed = await deploy.redeploy();
    if (!redeployed.ok) {
      blocked.push(
        `Novo deployment nao disparado (as variaveis so valem apos republicar): ${
          redeployed.error ?? ""
        }`.trim(),
      );
    }

    // Estado do frontend so vira "ok" com resposta HTTP real da URL operacional.
    const probe = await probeOperationalUrl(url.origin, input.fetchImpl);
    checks.frontend = probe.ok ? "ok" : "attention";
    if (!probe.ok) {
      blocked.push(`Frontend ainda nao respondeu em ${url.origin}: ${probe.detail}`);
    }

    await saveStageProgress(client, operation, {
      deployDone: true,
      appUrl: url.origin,
      urlSource: url.source,
      frontendOk: probe.ok,
    });

    await mark(
      "deploy",
      "done",
      `${envResult.applied} variáveis gravadas — URL operacional ${url.origin} (${
        url.source === "deploy" ? "temporária do deploy" : "domínio definitivo"
      })${redeployed.ok ? " · novo deployment disparado" : " · redeploy pendente"}${
        probe.ok ? " · frontend respondendo" : ` · frontend ${probe.detail}`
      }`,
    );
  }

  /* 5. banco, storage e seeds — só agora, com código publicado e URL própria. */
  const baselineEarly = await runBaselinePhase(url.origin, url.source);
  if (baselineEarly) return baselineEarly;


  /* 6. Brain stats */
  await mark("brain", "running");
  const brain = await management.query(stripPsqlMetaCommands(install011).sql);
  if (!brain.ok) {
    failures.push(`brain_stats_mv: ${brain.error ?? "falha"}`);
    await mark("brain", "error", "brain_stats_mv não inicializada");
  } else {
    await mark("brain", "done", "brain_stats_mv populada");
  }

  /* 7. cron na própria origem */
  await mark("cron", "running");
  const cron = await management.query(bindAppUrl(install020, url.origin));
  if (!cron.ok) {
    blocked.push(
      `Cron não agendado (a aplicação precisa responder em ${url.origin}): ${cron.error ?? ""}`.trim(),
    );
    checks.cron = "attention";
    await mark("cron", "error", "agendamento postergado");
  } else {
    checks.cron = "ok";
    await mark("cron", "done", "14 jobs na própria origem");
  }

  /* 8. verificação final READ-ONLY */
  await mark("validation", "running");
  const verify = await management.query(prepareVerificationSql(verifySql).sql);
  if (!verify.ok) {
    failures.push(`verify-installation: ${verify.error ?? "falha"}`);
    await mark("validation", "error", "verificação final falhou");
    return finish(url.origin, url.source);
  }
  const summary = summarizeVerificationRows(verify.rows);
  if (!summary.ok) {
    failures.push(`verify-installation: ${summary.reason ?? "resultado inconclusivo"}`);
    await mark("validation", "error", summary.reason);
    return finish(url.origin, url.source);
  }
  checks.connectivity = "ok";

  // Primeiro acesso NÃO bloqueia: a instalação já está operacional e o Super
  // Admin é criado no fluxo /setup da própria instalação.
  const firstAccess = await readFirstAccessState(management);
  checks.super_admin = firstAccess.superAdmin;
  checks.workspace = firstAccess.workspace;
  await mark(
    "validation",
    "done",
    `${summary.total} verificações PASS · ${firstAccess.detail}`,
  );


  return finish(url.origin, url.source);
}

/* ------------------------------------------------------------ primeiro acesso */

/**
 * Estado real do primeiro acesso da instalação: existe Super Admin e existe
 * EXATAMENTE um workspace. Não bloqueia a instalação (fica `attention`), mas
 * precisa ser reportado — sem isso o núcleo nunca é comprovado e o painel não
 * consegue afirmar que a instalação está PRONTA.
 */
async function readFirstAccessState(management: {
  query: (sql: string) => Promise<{ ok: boolean; rows: readonly unknown[]; error?: string | null }>;
}): Promise<{ superAdmin: CheckState; workspace: CheckState; detail: string }> {
  const res = await management.query(
    "select (public.installation_setup_state()->>'has_super_admin')::boolean as has_super_admin," +
      " (select count(*) from public.brands) as brand_count",
  );
  if (!res.ok) {
    return {
      superAdmin: "pending",
      workspace: "pending",
      detail: "primeiro acesso não verificado",
    };
  }
  const row = (res.rows[0] ?? {}) as { has_super_admin?: boolean | null; brand_count?: unknown };
  const hasSuperAdmin = row.has_super_admin === true;
  const brands = Number(row.brand_count ?? 0);
  const workspace: CheckState = brands === 1 ? "ok" : brands === 0 ? "attention" : "error";
  return {
    superAdmin: hasSuperAdmin ? "ok" : "attention",
    workspace,
    detail: hasSuperAdmin
      ? brands === 1
        ? "Super Admin criado · 1 workspace"
        : brands === 0
          ? "Super Admin criado · workspace ainda não criado"
          : `atenção: ${brands} workspaces (o modelo é 1 por instalação)`
      : "crie o primeiro Super Admin em /setup",
  };
}

/* ------------------------------------------------------- validação automática */


/** Distribui cada verificação do verify entre as etapas de validação da UI. */
export function classifyVerificationCheck(checkName: string): string {
  const name = checkName.toLowerCase();
  if (name.startsWith("isolamento") || name.startsWith("installation.app_url")) return "isolation";
  if (name.startsWith("sem dados de negócio")) return "isolation";
  if (name.startsWith("storage:")) return "storage";
  if (name.startsWith("cron:") || name.startsWith("vault:") || name.includes("brain_stats_mv"))
    return "cron";
  if (
    name.startsWith("rls ") ||
    name.includes("policies") ||
    name.includes("triggers") ||
    name.startsWith("trigger ")
  )
    return "rls";
  return "database";
}

type VerificationRow = { status: string; check_name: string; observed: string | null };

function normalizeVerificationRows(rows: readonly unknown[]): VerificationRow[] {
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      status: String(r["status"] ?? "").trim().toUpperCase(),
      check_name: String(r["check_name"] ?? "verificação sem nome"),
      observed: r["observed"] == null ? null : String(r["observed"]),
    }));
}

/**
 * Validação READ-ONLY executada pelo próprio MASTER via Management API, com as
 * credenciais de gestão do MASTER. Nada é criado ou alterado no destino — é o
 * mesmo `verify-installation.sql` do fallback manual, sem pedir Bash.
 */
export async function runAutomatedValidate(input: {
  client: Client;
  operation: OperationRow;
  installation: AutomationInstallation;
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetcher;
}): Promise<{ result: "PASS" | "FAIL" | "BLOCKED"; reasons: string[]; total: number }> {
  const env = input.env ?? runtimeEnv();
  const { client, operation, installation } = input;
  const stepIds = VALIDATE_STEPS.map((s) => s.id);

  const fail = async (result: "FAIL" | "BLOCKED", reason: string, stepId = stepIds[0]!) => {
    await report(client, operation, stepId, "error", reason);
    await finalizeOperation(client as never, operation as never, {
      ok: false,
      summary: `${result}: ${reason}`,
      errorKind: result.toLowerCase(),
    }).catch(() => undefined);
    return { result, reasons: [reason], total: 0 };
  };

  const capability = resolveAutomationCapability(env);
  if (!capability.available) return fail("BLOCKED", capability.blockedReasons.join(" | "));

  const target = resolveAutomationTarget(installation);
  if (!target.ok) return fail("BLOCKED", target.reason);

  const management = createManagementClient({
    token: (env["UNITOS_SUPABASE_MANAGEMENT_TOKEN"] ?? "").trim(),
    projectRef: target.projectRef,
    fetchImpl: input.fetchImpl,
  });

  for (const id of stepIds) await report(client, operation, id, "running");

  const verify = await management.query(prepareVerificationSql(verifySql).sql);
  if (!verify.ok) {
    return fail("BLOCKED", `verify-installation não pôde ser executado: ${verify.error ?? "falha"}`);
  }

  const rows = normalizeVerificationRows(verify.rows);
  if (rows.length === 0) {
    return fail("FAIL", "verify-installation não retornou nenhuma verificação");
  }

  const failedByStep = new Map<string, string[]>();
  const totalByStep = new Map<string, number>();
  for (const row of rows) {
    const step = classifyVerificationCheck(row.check_name);
    totalByStep.set(step, (totalByStep.get(step) ?? 0) + 1);
    if (row.status === "FAIL") {
      const list = failedByStep.get(step) ?? [];
      list.push(row.check_name);
      failedByStep.set(step, list);
    }
  }

  const checks: Partial<Record<HealthCheckId, CheckState>> = {};
  const checkByStep: Record<string, HealthCheckId> = {
    isolation: "configuration",
    database: "database",
    rls: "database",
    storage: "storage",
    cron: "cron",
  };

  for (const id of stepIds) {
    const failed = failedByStep.get(id) ?? [];
    const total = totalByStep.get(id) ?? 0;
    const healthId = checkByStep[id];
    if (healthId && checks[healthId] !== "error") {
      checks[healthId] = failed.length > 0 ? "error" : "ok";
    }
    await report(
      client,
      operation,
      id,
      failed.length > 0 ? "error" : "done",
      failed.length > 0
        ? `${failed.length} de ${total} em FAIL: ${failed.slice(0, 4).join("; ")}`
        : `${total} verificação(ões) PASS`,
    );
  }

  const summary = summarizeVerificationRows(verify.rows);
  if (summary.ok) checks.connectivity = "ok";

  // Reporta também o primeiro acesso (Super Admin + workspace único) para que o
  // painel possa concluir READY sem depender de inspeção manual.
  const firstAccess = await readFirstAccessState(management);
  checks.super_admin = firstAccess.superAdmin;
  checks.workspace = firstAccess.workspace;

  await finalizeOperation(client as never, operation as never, {
    ok: summary.ok,
    version: summary.ok ? MASTER_RELEASE_VERSION : null,
    summary: summary.ok
      ? `Validação automática concluída — ${summary.total} verificações PASS · ${firstAccess.detail}.`
      : `FAIL: ${summary.reason ?? "verificações em FAIL"}`,
    errorKind: summary.ok ? null : "fail",
    checks: checks as never,
  }).catch(() => undefined);


  return {
    result: summary.ok ? "PASS" : "FAIL",
    reasons: summary.ok ? [] : summary.failedChecks,
    total: summary.total,
  };
}

/* ----------------------------------------------------- atualização de código */

/**
 * ATUALIZAÇÃO DE CÓDIGO — traz o código publicado no MASTER para o deploy da
 * instalação. Dispara um novo build a partir do repositório ligado ao projeto
 * de deploy (branch de produção) e acompanha o estado até `READY`.
 *
 * Sem repositório ligado, o Vercel só permite reaproveitar o snapshot anterior:
 * nesse caso a operação termina em `attention` explicando que o código novo
 * exige um deploy ligado ao repositório — nunca finge sucesso.
 */
export async function runAutomatedUpdate(input: {
  client: Client;
  operation: OperationRow;
  installation: AutomationInstallation;
  env?: Record<string, string | undefined>;
  fetchImpl?: Fetcher;
  /** Commit do MASTER autorizado pelo Super Admin para esta instalação. */
  commitSha?: string | null;

  /** Tempo máximo aguardando o build ficar READY. */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ result: "PASS" | "PENDING" | "FAIL" | "BLOCKED"; reasons: string[] }> {
  const env = input.env ?? runtimeEnv();
  const { client, operation, installation } = input;

  const fail = async (result: "FAIL" | "BLOCKED", reason: string, stepId = "code") => {
    await report(client, operation, stepId, "error", reason);
    await finalizeOperation(client as never, operation as never, {
      ok: false,
      summary: `${result}: ${reason}`,
      errorKind: result.toLowerCase(),
    }).catch(() => undefined);
    return { result, reasons: [reason] };
  };

  const capability = resolveAutomationCapability(env);
  if (!capability.vercel.available) {
    return fail("BLOCKED", capability.vercel.reason ?? "token de deploy indisponível no MASTER");
  }
  const project = (installation.deployProject ?? "").trim();
  if (!project) {
    return fail("BLOCKED", "a instalação não tem projeto de deploy configurado");
  }

  const masterRepo = (env["UNITOS_MASTER_REPO"] ?? "").trim() || null;
  const repo = resolveInstallationRepo({
    gitRepoUrl: installation.gitRepoUrl ?? null,
    masterRepo: masterRepo ?? DEFAULT_MASTER_REPO,
  });
  if (!repo.ok) {
    return fail("BLOCKED", repo.reason);
  }
  if (!capability.github.available) {
    return fail("BLOCKED", capability.github.reason ?? "token do GitHub indisponível no MASTER");
  }

  const deploy = createDeployClient({
    token: (env["UNITOS_VERCEL_TOKEN"] ?? "").trim(),
    project,
    teamId: (env["UNITOS_VERCEL_TEAM_ID"] ?? "").trim() || null,
    masterRepo,
    repo: repo.slug,
    fetchImpl: input.fetchImpl,
  });
  const code = createCodeClient({
    token: (env["UNITOS_GITHUB_TOKEN"] ?? "").trim(),
    owner: repo.owner,
    repo: repo.repo,
    masterRepo,
    fetchImpl: input.fetchImpl,
  });

  const checkpoint = await readStageProgress(client, operation);
  let deploymentId = checkpoint.updateDeploymentId ?? null;
  let deploymentSource = checkpoint.updateDeploymentSource;
  let deploymentRef = checkpoint.updateDeploymentRef;

  // Commit autorizado pelo Super Admin (gravado na operação). Sem ele, fixa o
  // commit atual da branch do MASTER no momento da autorização.
  let targetSha = (input.commitSha ?? "").trim() || null;
  if (!targetSha) {
    const head = await code.masterHeadSha();
    if (!head.ok || !head.sha) {
      // Fail-closed: sem versão de origem identificada não há o que publicar.
      return fail("BLOCKED", head.error ?? "versão do MASTER não pôde ser identificada");
    }
    targetSha = head.sha;
  }

  // A instalação constrói o SEU repositório: a versão autorizada do MASTER é
  // publicada nele antes do build. Sem isso o deployment repetiria o código
  // antigo. Idempotente: repetir não gera commit novo (devolve o commit atual).
  let buildRef: string | null = null;
  if (!deploymentId) {
    await report(client, operation, "code", "running");
    const ensured = await code.ensureRepo();
    if (!ensured.ok) {
      return fail("BLOCKED", ensured.error ?? `repositório ${repo.slug} indisponível`);
    }
    const published = await code.publishSnapshot(targetSha);
    if (!published.ok) {
      return fail("FAIL", published.error ?? `não foi possível publicar em ${repo.slug}`);
    }
    buildRef = published.commitSha ?? null;
    await saveStageProgress(client, operation, {
      codeDone: true,
      codeSha: targetSha,
      codeRepo: repo.slug,
    });
  }


  if (!deploymentId) {
    await report(client, operation, "code", "running");
    // O build usa o commit do repositório DA INSTALAÇÃO (o snapshot recém
    // publicado), nunca o SHA do MASTER — ele não existe no outro repositório.
    const created = await deploy.deployLatestCode({ sha: buildRef });
    if (!created.ok || !created.deploymentId) {
      return fail("FAIL", created.error ?? "não foi possível disparar o deployment");
    }
    deploymentId = created.deploymentId;
    deploymentSource = created.source;
    deploymentRef = created.ref;
    await saveStageProgress(client, operation, {
      updateDeploymentId: deploymentId,
      updateDeploymentSource: deploymentSource,
      updateDeploymentRef: deploymentRef,
    });
  }


  if (deploymentSource === "rebuild") {
    await report(
      client,
      operation,
      "code",
      "done",
      "projeto de deploy sem repositório ligado — apenas rebuild do último snapshot",
    );
    await report(client, operation, "build", "done", "rebuild disparado");
    await report(client, operation, "version", "done", "versão não avançada");
    await finalizeOperation(client as never, operation as never, {
      ok: true,
      warnings: true,
      version: null,
      summary:
        "Rebuild disparado, mas o projeto de deploy não está ligado a um repositório: o código novo do MASTER não é aplicado assim. Ligue o projeto ao repositório e repita a atualização.",
    }).catch(() => undefined);
    return { result: "PENDING", reasons: ["deploy sem repositório ligado"] };
  }

  await report(
    client,
    operation,
    "code",
    "done",
    `deployment criado a partir de ${deploymentRef ?? "produção"}`,
  );

  await report(client, operation, "build", "running");
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (input.waitMs ?? 45_000);
  let state = "QUEUED";
  let url: string | null = null;
  while (Date.now() < deadline) {
    const status = await deploy.deploymentState(deploymentId);
    if (status.ok) {
      state = status.state ?? state;
      url = status.url ?? url;
      if (state === "READY") break;
      if (state === "ERROR" || state === "CANCELED") break;
    }
    // Mantém a lease viva durante builds longos: UI e cron não podem iniciar
    // outro runner nem criar deployments redundantes enquanto este responde.
    await saveStageProgress(client, operation, { updateDeploymentId: deploymentId });
    await sleep(3_000);
  }

  if (state === "ERROR" || state === "CANCELED") {
    return fail("FAIL", `o build terminou em ${state}`, "build");
  }

  if (state !== "READY") {
    // Não encerra prematuramente. O cron/watchdog retomará a MESMA operação e
    // consultará o MESMO deployment persistido até READY ou erro terminal.
    await report(client, operation, "build", "running", `build em andamento (${state})`);
    await saveStageProgress(client, operation, { updateDeploymentId: deploymentId });
    return { result: "PENDING", reasons: [`build em ${state}`] };
  }

  await report(client, operation, "build", "done", url ? `publicado em ${url}` : "publicado");
  const shortSha = targetSha ? targetSha.slice(0, 7) : null;
  await report(
    client,
    operation,
    "version",
    "done",
    shortSha ? `${MASTER_RELEASE_VERSION} (${shortSha})` : MASTER_RELEASE_VERSION,
  );

  // Fixa a versão publicada: a instalação passa a ficar parada neste ponto do
  // código até uma nova autorização.
  if (targetSha) {
    await (
      client.from("installations") as unknown as {
        update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
      }
    )
      .update({
        pinned_commit_sha: targetSha,
        pinned_release: MASTER_RELEASE_VERSION,
        pinned_at: new Date().toISOString(),
      })
      .eq("id", installation.id)
      .then(
        () => undefined,
        () => undefined,
      );
  }

  await finalizeOperation(client as never, operation as never, {
    ok: true,
    version: MASTER_RELEASE_VERSION,
    summary: shortSha
      ? `Atualização aplicada: código do MASTER (${MASTER_RELEASE_VERSION} · ${shortSha}) publicado na instalação.`
      : `Atualização aplicada: código do MASTER (${MASTER_RELEASE_VERSION}) publicado na instalação.`,
  }).catch(() => undefined);


  return { result: "PASS", reasons: [] };
}
