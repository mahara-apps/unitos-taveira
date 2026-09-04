/**
 * Perfis de acesso do workspace (`public.access_profiles`) + permissões
 * efetivas por módulo. A autoridade real é do banco (RLS + guards):
 * somente SUPER ADMIN / OWNER / ADMIN escrevem.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin, resolveModulePermissions } from "@/lib/access-guard";
import {
  MODULE_KEYS,
  MODULE_LEVELS,
  levelsForModule,
  normalizeModulePermissions,
  type ModuleKey,
  type ModuleLevel,
  type PartialModulePermissions,
} from "@/lib/module-permissions";

const BrandInput = z.object({ brandId: z.string().uuid() });

const PermissionsMapInput = z
  .record(z.enum(MODULE_KEYS), z.enum(MODULE_LEVELS))
  .transform((raw) => {
    const out: PartialModulePermissions = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = k as ModuleKey;
      const level = v as ModuleLevel;
      out[key] = levelsForModule(key).includes(level) ? level : "none";
    }
    return out;
  });

export type AccessProfileDTO = {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: PartialModulePermissions;
};

export const listAccessProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }): Promise<{ profiles: AccessProfileDTO[] }> => {
    const { data: rows, error } = await context.supabase
      .from("access_profiles")
      .select("id, key, name, is_system, permissions")
      .eq("brand_id", data.brandId)
      .order("is_system", { ascending: false })
      .order("name");
    if (error) throw error;
    return {
      profiles: (rows ?? []).map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        isSystem: r.is_system,
        permissions: normalizeModulePermissions(r.permissions),
      })),
    };
  });

/** Permissões efetivas do usuário logado (gating de sidebar e botões). */
export const myModulePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }) => {
    const permissions = await resolveModulePermissions(
      context.supabase,
      context.userId,
      data.brandId,
    );
    return { permissions };
  });

const SaveProfileInput = z.object({
  brandId: z.string().uuid(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(60),
  permissions: PermissionsMapInput,
});

export const saveAccessProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const role = await assertBrandAdmin(context.supabase, context.userId, data.brandId, {
      allowManager: false,
    });
    void role;

    if (data.id) {
      const { error } = await context.supabase
        .from("access_profiles")
        .update({ name: data.name, permissions: data.permissions })
        .eq("id", data.id)
        .eq("brand_id", data.brandId);
      if (error) throw error;
      return { id: data.id };
    }

    const key = `custom_${Date.now().toString(36)}`;
    const { data: created, error } = await context.supabase
      .from("access_profiles")
      .insert({
        brand_id: data.brandId,
        key,
        name: data.name,
        is_system: false,
        permissions: data.permissions,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: created.id };
  });

const DeleteProfileInput = z.object({
  brandId: z.string().uuid(),
  id: z.string().uuid(),
});

export const deleteAccessProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.supabase, context.userId, data.brandId, {
      allowManager: false,
    });
    const { error } = await context.supabase
      .from("access_profiles")
      .delete()
      .eq("id", data.id)
      .eq("brand_id", data.brandId);
    if (error) {
      if (/system_profile_delete_blocked/.test(error.message)) {
        throw new Error("Perfis do sistema não podem ser removidos.");
      }
      throw error;
    }
    return { ok: true };
  });

const SaveMemberPermissionsInput = z.object({
  brandId: z.string().uuid(),
  userId: z.string().uuid(),
  accessProfileId: z.string().uuid().nullable().optional(),
  /** `null` = sem ajustes individuais (usa exatamente o perfil). */
  modulePermissions: PermissionsMapInput.nullable().optional(),
});

export const saveMemberModulePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveMemberPermissionsInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.supabase, context.userId, data.brandId, {
      allowManager: false,
    });
    if (data.accessProfileId) {
      const { data: prof, error: pErr } = await context.supabase
        .from("access_profiles")
        .select("id")
        .eq("id", data.accessProfileId)
        .eq("brand_id", data.brandId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!prof) throw new Error("Perfil de acesso não pertence a este workspace.");
    }

    const patch: {
      access_profile_id?: string | null;
      module_permissions?: PartialModulePermissions | null;
    } = {};
    if (data.accessProfileId !== undefined) patch.access_profile_id = data.accessProfileId;
    if (data.modulePermissions !== undefined) {
      patch.module_permissions =
        data.modulePermissions && Object.keys(data.modulePermissions).length > 0
          ? data.modulePermissions
          : null;
    }
    const { error } = await context.supabase
      .from("brand_members")
      .update(patch)
      .eq("brand_id", data.brandId)
      .eq("user_id", data.userId);
    if (error) throw error;
    return { ok: true };
  });
