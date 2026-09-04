import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAuthorityRole, type AuthorityRole } from "@/lib/access-guard";

export type MyAccess = {
  userId: string;
  brandId: string | null;
  /** Papel canônico (autoridade). */
  role: AuthorityRole | null;
  isSuperAdmin: boolean;
  /** Papel bruto em `brand_members` (compatibilidade/telas de equipe). */
  brandRole: string | null;
  /** Escopo: clientes acessíveis nesta marca (regra idêntica à RLS). */
  clientIds: string[];
  brandIds: string[];
};

/**
 * Fonte única de papel + escopo para o frontend. Toda decisão real de acesso
 * continua na RLS/server functions — este endpoint só espelha a mesma regra
 * (`public.my_access`) para a UI não divergir do banco.
 */
export const getMyAccessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ brandId: z.string().uuid().nullable().optional() })
      .default({})
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<MyAccess> => {
    const { supabase, userId } = context;
    const { data: raw, error } = await supabase.rpc(
      "my_access" as never,
      {
        _brand_id: data.brandId ?? null,
      } as never,
    );
    if (error) throw error;

    const row = (raw ?? {}) as Record<string, unknown>;
    const ids = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

    return {
      userId,
      brandId: data.brandId ?? null,
      role: isAuthorityRole(row["role"]) ? row["role"] : null,
      isSuperAdmin: row["is_super_admin"] === true,
      brandRole: typeof row["brand_role"] === "string" ? row["brand_role"] : null,
      clientIds: ids(row["client_ids"]),
      brandIds: ids(row["brand_ids"]),
    };
  });
