// ⚠️ Brain Core — tipos e contrato compartilhado entre os módulos internos do Brain.
// Nenhum consumidor externo deve importar deste caminho. Use `src/lib/brain/api.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contexto passado a todo módulo do Brain. Carrega o cliente Supabase já
 * autenticado (RLS aplicada como o usuário chamador) + escopo lógico.
 */
export interface BrainContext {
  supabase: SupabaseClient;
  userId: string;
  /** Escopo opcional: null significa "sistema/agência". */
  brandId?: string | null;
  clientId?: string | null;
  /** Projeto atualmente aberto (opcional — restringe métricas e memórias). */
  projectId?: string | null;
  /** Módulo/rota de origem da pergunta (chat, content, tasks, analytics, ...). */
  module?: string | null;
  /** Janela temporal opcional para filtrar métricas/memórias. */
  period?: { from?: string | null; to?: string | null } | null;
  /** Permissões efetivas do usuário no escopo (usado para gate de contexto). */
  permissions?: string[] | null;
}

/** Envelope canônico de evento publicado no Event Bus. */
export interface BrainEventInput {
  brand_id: string | null;
  client_id?: string | null;
  source_module: string;
  event_type: string;
  /**
   * FASE 10E.2 — o ator NUNCA é aceito do chamador. `publish()` deriva sempre de
   * `ctx.userId` (identidade autenticada) e o banco reforça `actor_id = auth.uid()`.
   * Eventos de sistema (service_role/worker) ficam com ator nulo.
   */
  /** Entidade de origem do evento (opcional). */
  entity_type?: string | null;
  entity_id?: string | null;
  payload: Record<string, unknown>;
}

/** Escopo de isolamento resolvido pelo banco (trigger brain_scope_guard). */
export type BrainScope = "global" | "brand" | "client";

/** Espelha as colunas REAIS de public.brain_memory (não existe topic/summary). */
export interface BrainMemoryRow {
  id: string;
  title: string;
  description: string;
  category: string;
  scope: BrainScope;
  confidence: number | null;
  reinforcement_count: number;
  brand_id: string | null;
  client_id: string | null;
  updated_at: string | null;
}

export interface BrainInsightRow {
  id?: string;
  insight_type: string;
  description: string;
  confidence: number | null;
  expires_at?: string | null;
  scope?: BrainScope;
  brand_id?: string | null;
  client_id?: string | null;
}

export interface SemanticMemoryHit {
  content_summary: string;
  similarity: number;
  event_type: string;
}

export interface BrainStats {
  posts?: number;
  tasks?: number;
  projects?: number;
  [key: string]: number | undefined;
}
