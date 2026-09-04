import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  classifyReconnectFailure,
  reconnectDiagnosis,
  type ReconnectDiagnosis,
  type ReconnectDiagnosisKind,
} from "@/lib/meta/reconnect-diagnosis";

/**
 * Reconexão explícita de um canal já conectado.
 *
 * Regra crítica: NUNCA substituir silenciosamente a conta vinculada.
 * `inspectMetaConnectionFn` é uma leitura em modo seco (não escreve nada) que
 * compara a conta atual com a conta que a Meta devolve agora.
 * `applyMetaReconnectFn` só grava os identificadores novos quando o usuário
 * confirma (`acceptNewAccount: true`); caso contrário mantém a configuração
 * atual e apenas atualiza o carimbo de verificação.
 *
 * Não altera tokens, escopos, criptografia, worker ou pipeline de publicação.
 */

const Input = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid(),
});

export type ChannelAccountSnapshot = {
  pageId: string | null;
  pageName: string | null;
  instagramBusinessId: string | null;
  instagramUsername: string | null;
};

export type InspectResult = {
  ok: boolean;
  changed: boolean;
  current: ChannelAccountSnapshot;
  found: ChannelAccountSnapshot | null;
  /** Diagnóstico categorizado: problema → causa provável → ação recomendada. */
  diagnosis: ReconnectDiagnosis;
  /** Texto técnico da Meta — exibido SOMENTE em "Detalhes técnicos". */
  technical: string | null;
  /** Mensagem operacional (sem detalhe técnico). */
  message: { title: string; description: string } | null;
};

type PageNode = {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
};

/**
 * Leitura da conta respeitando o TIPO de nó salvo.
 *
 * `instagram_business_account` só existe no nó Page. Quando a conexão guarda um
 * ID de conta do Instagram (canal instagram vinculado direto), consultar esse
 * campo devolve `(#100) Tried accessing nonexistent field` — não é permissão.
 * Por isso: Page → campos da Página; IG User → `id,username`.
 */
async function readAccount(
  provider: { graph: <T>(path: string, opts: Record<string, unknown>) => Promise<T> },
  row: {
    channel: string;
    external_id: string;
    page_id: string | null;
    instagram_business_id: string | null;
    account_id: string | null;
  },
  accessToken: string,
): Promise<{ found: ChannelAccountSnapshot; kind: ReconnectDiagnosisKind | null }> {
  const pageId = row.page_id ?? (row.channel === "facebook" ? row.external_id : null);
  const igId =
    row.instagram_business_id ??
    row.account_id ??
    (row.channel === "instagram" ? row.external_id : null);

  if (pageId) {
    try {
      const page = await provider.graph<PageNode>(`/${pageId}`, {
        accessToken,
        query: { fields: "id,name,instagram_business_account{id,username}" },
      });
      return {
        found: {
          pageId: page.id ?? null,
          pageName: page.name ?? null,
          instagramBusinessId: page.instagram_business_account?.id ?? null,
          instagramUsername: page.instagram_business_account?.username ?? null,
        },
        kind:
          row.channel === "instagram" && !page.instagram_business_account?.id ? "not_linked" : null,
      };
    } catch (err) {
      // Página inválida para este canal: caímos para o nó do Instagram quando existir.
      if (!igId) throw err;
    }
  }

  if (!igId) throw new Error("Unsupported get request: nenhum identificador utilizável.");

  const ig = await provider.graph<{ id: string; username?: string; name?: string }>(`/${igId}`, {
    accessToken,
    query: { fields: "id,username,name" },
  });
  return {
    found: {
      pageId: row.page_id ?? null,
      pageName: ig.name ?? null,
      instagramBusinessId: ig.id ?? null,
      instagramUsername: ig.username ?? null,
    },
    kind: null,
  };
}

function graphOf(err: unknown): { code?: number; error_subcode?: number } | undefined {
  const g = (err as { graph?: { code?: number; error_subcode?: number } } | null)?.graph;
  return g ?? undefined;
}

function technicalOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const code = graphOf(err)?.code;
  return code ? `(#${code}) ${msg}` : msg || "Falha desconhecida na Graph API.";
}

async function loadConnection(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          eq: (
            k: string,
            v: string,
          ) => {
            eq: (
              k: string,
              v: string,
            ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
          };
        };
      };
    };
  },
  connectionId: string,
  brandId: string,
) {
  const res = await supabase
    .from("social_connections")
    .select(
      "id, channel, status, external_id, external_name, account_id, account_username, page_id, instagram_business_id, access_token_ciphertext",
    )
    .eq("id", connectionId)
    .eq("brand_id", brandId)
    .eq("provider", "meta")
    .maybeSingle();
  if (res.error) throw new Error("connection_read_failed");
  return res.data as {
    id: string;
    channel: string;
    status: string;
    external_id: string;
    external_name: string | null;
    account_id: string | null;
    account_username: string | null;
    page_id: string | null;
    instagram_business_id: string | null;
    access_token_ciphertext: string;
  } | null;
}

export const inspectMetaConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<InspectResult> => {
    const row = await loadConnection(context.supabase as never, data.connectionId, data.brandId);
    const empty: ChannelAccountSnapshot = {
      pageId: null,
      pageName: null,
      instagramBusinessId: null,
      instagramUsername: null,
    };
    if (!row) {
      const d = reconnectDiagnosis("not_found");
      return {
        ok: false,
        changed: false,
        current: empty,
        found: null,
        diagnosis: d,
        technical: null,
        message: { title: d.title, description: d.action },
      };
    }

    const current: ChannelAccountSnapshot = {
      pageId: row.page_id ?? (row.channel === "facebook" ? row.external_id : null),
      pageName: row.external_name ?? null,
      instagramBusinessId: row.instagram_business_id ?? row.account_id ?? null,
      instagramUsername: row.account_username ?? null,
    };

    try {
      const { decryptCredential } = await import("@/lib/credentials-crypto.server");
      const { MetaProvider } = await import("./provider.server");
      const provider = new MetaProvider();
      const pageToken = await decryptCredential(row.access_token_ciphertext);
      const { found, kind } = await readAccount(provider as never, row, pageToken);

      const changed =
        (current.pageId ?? "") !== (found.pageId ?? "") ||
        (current.instagramBusinessId ?? "") !== (found.instagramBusinessId ?? "") ||
        (current.instagramUsername ?? "") !== (found.instagramUsername ?? "");

      const diagnosisKind: ReconnectDiagnosisKind = kind ?? (changed ? "identity_mismatch" : "ok");
      const d = reconnectDiagnosis(diagnosisKind);
      return {
        ok: diagnosisKind !== "not_linked",
        changed,
        current,
        found,
        diagnosis: d,
        technical: null,
        message: null,
      };
    } catch (err) {
      console.error("[meta:inspect] falha ao verificar conexão", err);
      const kind = classifyReconnectFailure(
        err instanceof Error ? err.message : String(err),
        graphOf(err),
        (err as { status?: number } | null)?.status,
      );
      const d = reconnectDiagnosis(kind);
      return {
        ok: false,
        changed: false,
        current,
        found: null,
        diagnosis: d,
        technical: technicalOf(err),
        message: { title: d.title, description: d.action },
      };
    }
  });

const ApplyInput = Input.extend({
  /** true = usuário confirmou explicitamente a troca de conta. */
  acceptNewAccount: z.boolean().default(false),
});

export const applyMetaReconnectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApplyInput.parse(i))
  .handler(async ({ data, context }) => {
    const row = await loadConnection(context.supabase as never, data.connectionId, data.brandId);
    if (!row) {
      return {
        ok: false,
        message: {
          title: "Canal não encontrado",
          description: "Conecte o canal novamente para continuar publicando.",
        },
      };
    }

    // Token antigo NUNCA reativa uma conta revogada/expirada: reativação só
    // acontece via nova autorização + descoberta (reconcileMetaConnectionFn).
    if (row.status !== "active" && row.status !== "attention") {
      return {
        ok: false,
        message: {
          title: "Nova autorização necessária",
          description:
            "Esta conta não está mais autorizada. Use “Nova autorização na Meta” para reconectar — não reutilizamos a credencial anterior.",
        },
      };
    }

    try {
      const { decryptCredential } = await import("@/lib/credentials-crypto.server");
      const { MetaProvider } = await import("./provider.server");
      const provider = new MetaProvider();
      const pageToken = await decryptCredential(row.access_token_ciphertext);
      const { found } = await readAccount(provider as never, row, pageToken);

      const nowIso = new Date().toISOString();
      const patch: {
        status: string;
        last_error: string | null;
        last_synced_at: string;
        external_name?: string | null;
        account_id?: string | null;
        account_username?: string | null;
        instagram_business_id?: string | null;
      } = {
        status: "active",
        last_error: null,
        last_synced_at: nowIso,
      };

      const igChanged =
        (row.instagram_business_id ?? row.account_id ?? "") !== (found.instagramBusinessId ?? "");

      if (data.acceptNewAccount) {
        patch.external_name = found.pageName ?? row.external_name;
        patch.account_id = found.instagramBusinessId ?? null;
        patch.account_username = found.instagramUsername ?? null;
        if (row.channel === "instagram") {
          patch.instagram_business_id = found.instagramBusinessId ?? null;
        }
      } else if (!igChanged) {
        // Sem troca de conta: só normalizamos o nome exibido.
        patch.external_name = found.pageName ?? row.external_name;
      }

      const { error } = await context.supabase
        .from("social_connections")
        .update(patch)
        .eq("id", row.id)
        .eq("brand_id", data.brandId);
      if (error) throw new Error(error.message);

      return {
        ok: true,
        accountChanged: igChanged,
        applied: data.acceptNewAccount,
        message: null as null | { title: string; description: string },
      };
    } catch (err) {
      console.error("[meta:reconnect] falha ao aplicar reconexão", err);
      const d = reconnectDiagnosis(
        classifyReconnectFailure(
          err instanceof Error ? err.message : String(err),
          graphOf(err),
          (err as { status?: number } | null)?.status,
        ),
      );
      await context.supabase
        .from("social_connections")
        .update({ status: "attention" })
        .eq("id", data.connectionId)
        .eq("brand_id", data.brandId);
      return {
        ok: false,
        message: { title: d.title, description: d.action },
        technical: technicalOf(err),
      };
    }
  });
