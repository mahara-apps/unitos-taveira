// Tipos client-safe compartilhados pelo canal de e-mail (sem segredos).

/** Client Supabase mínimo necessário para ler a credencial da marca (RLS aplicada). */
export type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};
