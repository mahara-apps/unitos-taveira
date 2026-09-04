/**
 * FASE 10C.2 — ponto ÚNICO de escrita em `public.message_logs`.
 *
 * Regras não negociáveis:
 * - O chamador declara o escopo explicitamente: `workspace` (client_id NULL)
 *   ou `client` (client_id obrigatório). Não existe default nem fallback.
 * - O `clientId` NUNCA é aceito só porque veio do frontend: é sempre
 *   revalidado no servidor contra `clients.brand_id` e contra o escopo do
 *   usuário (`can_access_client`) quando houver ator autenticado.
 * - Em fluxo de worker/service_role a relação estrutural brand → client é
 *   validada antes da gravação (o bypass de RLS não dispensa a checagem).
 * - Fluxo client-level sem `clientId` FALHA explicitamente — nunca grava NULL
 *   silenciosamente.
 * - Proibido derivar cliente de "cliente ativo", "último selecionado",
 *   "primeiro cliente" ou qualquer estado global de UI.
 */
import { assertBrandMember, assertClientInBrand, type RpcClient } from "@/lib/access-guard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageLogScope =
  | { scope: "workspace"; brandId: string }
  | { scope: "client"; brandId: string; clientId: string };

/** Ator do log: usuário autenticado (RLS) ou worker com service_role. */
export type MessageLogActor = { kind: "user"; userId: string } | { kind: "service_role" };

export type MessageLogInput = {
  channel: string;
  status: string;
  recipient?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  sentAt?: string;
  deliveredAt?: string | null;
  failedAt?: string | null;
};

type WriteClient = RpcClient & { from: unknown };

type ClientRow = { id: string; brand_id: string };

/** Valida a relação estrutural brand → client direto na tabela `clients`. */
async function assertStructuralBrandClient(
  supabase: WriteClient,
  brandId: string,
  clientId: string,
): Promise<void> {
  const q = (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{ data: ClientRow | null; error: { message: string } | null }>;
          };
        };
      };
    }
  ).from("clients");
  const { data, error } = await q.select("id, brand_id").eq("id", clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("message_log: cliente inexistente");
  if (data.brand_id !== brandId) {
    throw new Error("message_log: par brand_id/client_id inconsistente");
  }
}

/**
 * Grava um registro em `message_logs` com escopo validado no servidor.
 * Retorna o id criado.
 */
export async function logMessage(
  supabase: WriteClient,
  actor: MessageLogActor,
  scope: MessageLogScope,
  input: MessageLogInput,
): Promise<string> {
  if (!scope.brandId || !UUID_RE.test(scope.brandId)) {
    throw new Error("message_log: brandId obrigatório");
  }
  if (!input.channel || !input.status) {
    throw new Error("message_log: channel e status obrigatórios");
  }

  let clientId: string | null = null;

  if (scope.scope === "client") {
    // Client level: ausência de cliente é erro, nunca NULL silencioso.
    if (!scope.clientId || !UUID_RE.test(scope.clientId)) {
      throw new Error("message_log: fluxo client-level exige clientId válido");
    }
    clientId = scope.clientId;
    if (actor.kind === "user") {
      // Escopo do usuário + pertencimento ao workspace + brand↔client.
      await assertBrandMember(supabase, actor.userId, scope.brandId);
      await assertClientInBrand(supabase, actor.userId, scope.brandId, clientId);
    } else {
      await assertStructuralBrandClient(supabase, scope.brandId, clientId);
    }
  } else if (actor.kind === "user") {
    // Workspace level continua legítimo (client_id NULL), mas o brandId
    // recebido precisa ser revalidado.
    await assertBrandMember(supabase, actor.userId, scope.brandId);
  }

  const insert = (
    supabase as unknown as {
      from: (t: string) => {
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  ).from("message_logs");

  const { data, error } = await insert
    .insert({
      brand_id: scope.brandId,
      client_id: clientId,
      channel: input.channel,
      status: input.status,
      recipient: input.recipient ?? null,
      provider_message_id: input.providerMessageId ?? null,
      error_message: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
      ...(input.sentAt ? { sent_at: input.sentAt } : {}),
      ...(input.deliveredAt ? { delivered_at: input.deliveredAt } : {}),
      ...(input.failedAt ? { failed_at: input.failedAt } : {}),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "message_log: falha ao gravar");
  return data.id;
}
