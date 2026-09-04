// Server-only: resolução de escopo (workspace/cliente) e de configuração para
// operações sobre instâncias Evolution.

import { assertBrandAdmin, assertClientScope } from "@/lib/access-guard";
import { EVOLUTION_PROVIDER, resolveEvolutionConfig } from "./config.server";
import type { EvolutionConfig } from "./config.server";

// Aceita o client autenticado do middleware sem depender dos genéricos gerados.
type AnySupabase = Parameters<typeof assertBrandAdmin>[0] & {
  from: (table: string) => any;
};

export type EvolutionInstanceRecord = {
  id: string;
  brand_id: string;
  client_id: string | null;
  instance_name: string;
  status: string;
};

/** Carrega a instância garantindo que ela pertence ao workspace informado. */
export async function loadInstance(
  supabase: AnySupabase,
  brandId: string,
  instanceId: string,
): Promise<EvolutionInstanceRecord> {
  const { data, error } = await supabase
    .from("evolution_instances")
    .select("id, brand_id, client_id, instance_name, status")
    .eq("id", instanceId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Instância não encontrada neste workspace.");
  return data as EvolutionInstanceRecord;
}

/** Exige autoridade administrativa no workspace + escopo do cliente vinculado. */
export async function assertInstanceAdmin(
  supabase: AnySupabase,
  userId: string,
  brandId: string,
  clientId: string | null,
): Promise<void> {
  await assertBrandAdmin(supabase, userId, brandId);
  if (clientId) await assertClientScope(supabase, userId, clientId);
}

/** Configuração efetiva da Evolution para o workspace. */
export async function resolveInstanceConfig(
  supabase: AnySupabase,
  brandId: string,
): Promise<EvolutionConfig> {
  const { data, error } = await supabase
    .from("brand_api_credentials")
    .select("ciphertext, metadata")
    .eq("brand_id", brandId)
    .eq("provider", EVOLUTION_PROVIDER)
    .maybeSingle();
  if (error) throw error;
  return resolveEvolutionConfig(data);
}
