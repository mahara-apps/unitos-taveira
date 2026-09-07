import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import {
  DiscoverAccountsInput,
  EMPTY_METRICS,
  LinkAccountInput,
  ListAccountsInput,
  ReportInput,
  SyncAccountInput,
  UnlinkAccountInput,
  resultLabelFor,
  withDerived,
  type AdAccountRow,
  type AdsLevel,
  type AdsMetrics,
  type AdsReport,
  type AdsRowItem,
  type AdsSeriesPoint,
} from "./ads-shared";

export type {
  AdAccountRow,
  AdsLevel,
  AdsMetrics,
  AdsReport,
  AdsRowItem,
  AdsSeriesPoint,
} from "./ads-shared";

/** Falta de autorização de anúncios — a UI usa o prefixo para orientar. */
export const ADS_SCOPE_PREFIX = "ADS_SCOPE_REQUIRED:";

// ------------------------------------------------------------------- Listing

export const listAdAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListAccountsInput.parse(input))
  .handler(async ({ data, context }): Promise<{ accounts: AdAccountRow[] }> => {
    const { data: rows, error } = await context.supabase
      .from("ad_accounts")
      .select(
        "id, provider, external_id, name, currency, timezone, account_status, business_name, last_synced_at, sync_status, sync_error",
      )
      .eq("brand_id", data.brandId)
      .order("name", { ascending: true });
    if (error) throw error;

    const ids = (rows ?? []).map((r) => r.id);
    let links: Array<{ id: string; client_id: string; ad_account_id: string }> = [];
    let clientNames = new Map<string, string | null>();
    if (ids.length) {
      const { data: linkRows, error: linkErr } = await context.supabase
        .from("client_ad_accounts")
        .select("id, client_id, ad_account_id")
        .in("ad_account_id", ids);
      if (linkErr) throw linkErr;
      links = linkRows ?? [];
      const clientIds = [...new Set(links.map((l) => l.client_id))];
      if (clientIds.length) {
        const { data: clients } = await context.supabase
          .from("clients")
          .select("id, name")
          .in("id", clientIds);
        clientNames = new Map((clients ?? []).map((c) => [c.id, c.name ?? null]));
      }
    }

    return {
      accounts: (rows ?? []).map((r) => ({
        id: r.id,
        provider: (r.provider as "meta" | "google") ?? "meta",
        externalId: r.external_id,
        name: r.name ?? null,
        currency: r.currency ?? null,
        timezone: r.timezone ?? null,
        accountStatus: r.account_status ?? null,
        businessName: r.business_name ?? null,
        lastSyncedAt: r.last_synced_at ?? null,
        syncStatus: (r.sync_status as AdAccountRow["syncStatus"]) ?? "not_loaded",
        syncError: r.sync_error ?? null,
        clients: links
          .filter((l) => l.ad_account_id === r.id)
          .map((l) => ({
            linkId: l.id,
            clientId: l.client_id,
            clientName: clientNames.get(l.client_id) ?? null,
          })),
      })),
    };
  });

// ----------------------------------------------------------------- Discovery

/**
 * Busca na Meta as contas de anúncio que o token do workspace alcança e
 * registra/atualiza cada uma. Exige autoridade de integração do workspace.
 */
export const discoverAdAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DiscoverAccountsInput.parse(input))
  .handler(async ({ data, context }): Promise<{ found: number; saved: number }> => {
    const { assertIntegrationAuthority } = await import("@/lib/access-guard");
    await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);

    const { data: sessions, error } = await context.supabase
      .from("meta_oauth_sessions")
      .select("id, scopes, user_token_ciphertext, expires_at")
      .eq("brand_id", data.brandId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    const usable = (sessions ?? []).find(
      (s) =>
        !!s.user_token_ciphertext &&
        new Date(s.expires_at).getTime() > Date.now() &&
        ((s.scopes as string[] | null) ?? []).includes("ads_read"),
    );
    if (!usable) {
      throw new Error(
        `${ADS_SCOPE_PREFIX} Nenhuma autorização da Meta com permissão de leitura de anúncios. Autorize novamente em Conexões escolhendo o canal de anúncios.`,
      );
    }

    const { decryptCredential } = await import("@/lib/credentials-crypto.server");
    const { MetaProvider } = await import("@/lib/meta/provider.server");
    const token = await decryptCredential(usable.user_token_ciphertext!);
    const accounts = await new MetaProvider().listAdAccounts(token);

    let saved = 0;
    for (const a of accounts) {
      const { error: upErr } = await context.supabase.from("ad_accounts").upsert(
        {
          brand_id: data.brandId,
          provider: "meta",
          external_id: a.adAccountId,
          name: a.name,
          currency: a.currency,
          timezone: a.timezone,
          account_status: a.accountStatus,
          business_name: a.businessName,
          meta_session_id: usable.id,
        },
        { onConflict: "brand_id,provider,external_id" },
      );
      if (upErr) throw upErr;
      saved += 1;
    }
    return { found: accounts.length, saved };
  });

export const linkAdAccountToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LinkAccountInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertIntegrationAuthority } = await import("@/lib/access-guard");
    await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);
    const { error } = await context.supabase.from("client_ad_accounts").upsert(
      {
        brand_id: data.brandId,
        client_id: data.clientId,
        ad_account_id: data.adAccountId,
        created_by: context.userId,
      },
      { onConflict: "client_id,ad_account_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const unlinkAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnlinkAccountInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertIntegrationAuthority } = await import("@/lib/access-guard");
    await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);
    const { error } = await context.supabase
      .from("client_ad_accounts")
      .delete()
      .eq("id", data.linkId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true };
  });

// ------------------------------------------------------------------- Syncing

export const syncAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SyncAccountInput.parse(input))
  .handler(
    async ({ data, context }): Promise<{ entities: number; insights: number; days: number }> => {
      const { assertIntegrationAuthority } = await import("@/lib/access-guard");
      await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);

      const { data: account, error } = await context.supabase
        .from("ad_accounts")
        .select("id, external_id, meta_session_id, provider")
        .eq("id", data.adAccountId)
        .eq("brand_id", data.brandId)
        .maybeSingle();
      if (error) throw error;
      if (!account) throw new Error("Conta de anúncio não encontrada neste workspace.");
      if (account.provider !== "meta") {
        throw new Error("Sincronização disponível apenas para contas da Meta nesta versão.");
      }

      const { data: sessions } = await context.supabase
        .from("meta_oauth_sessions")
        .select("id, scopes, user_token_ciphertext, expires_at")
        .eq("brand_id", data.brandId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      const usable =
        (sessions ?? []).find(
          (s) => s.id === account.meta_session_id && !!s.user_token_ciphertext,
        ) ??
        (sessions ?? []).find(
          (s) =>
            !!s.user_token_ciphertext &&
            new Date(s.expires_at).getTime() > Date.now() &&
            ((s.scopes as string[] | null) ?? []).includes("ads_read"),
        );
      if (!usable) {
        throw new Error(
          `${ADS_SCOPE_PREFIX} Nenhuma autorização da Meta com permissão de leitura de anúncios. Autorize novamente em Conexões.`,
        );
      }

      const days = data.days ?? 90;
      const until = new Date();
      const since = new Date(until.getTime() - (days - 1) * 86_400_000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      const markFailure = async (message: string) => {
        await context.supabase
          .from("ad_accounts")
          .update({ sync_status: "error", sync_error: message.slice(0, 500) })
          .eq("id", account.id);
      };

      try {
        const { decryptCredential } = await import("@/lib/credentials-crypto.server");
        const { MetaProvider } = await import("@/lib/meta/provider.server");
        const { fetchMetaEntities, fetchMetaInsights } = await import("./meta-ads.server");
        const provider = new MetaProvider();
        const token = await decryptCredential(usable.user_token_ciphertext!);

        const { entities, creatives } = await fetchMetaEntities(
          provider,
          token,
          account.external_id,
        );

        if (entities.length) {
          const { error: entErr } = await context.supabase.from("ad_entities").upsert(
            entities.map((e) => ({
              brand_id: data.brandId,
              ad_account_id: account.id,
              level: e.level,
              external_id: e.externalId,
              parent_external_id: e.parentExternalId,
              name: e.name,
              objective: e.objective,
              status: e.status,
              effective_status: e.effectiveStatus,
              daily_budget: e.dailyBudget,
              lifetime_budget: e.lifetimeBudget,
              start_time: e.startTime,
              stop_time: e.stopTime,
            })),
            { onConflict: "ad_account_id,level,external_id" },
          );
          if (entErr) throw entErr;
        }

        if (creatives.length) {
          const { error: crErr } = await context.supabase.from("ad_creatives").upsert(
            creatives.map((c) => ({
              brand_id: data.brandId,
              ad_account_id: account.id,
              ad_external_id: c.adExternalId,
              creative_external_id: c.creativeExternalId,
              title: c.title,
              body: c.body,
              thumbnail_url: c.thumbnailUrl,
              image_url: c.imageUrl,
              video_id: c.videoId,
              link_url: c.linkUrl,
              call_to_action: c.callToAction,
            })),
            { onConflict: "ad_account_id,ad_external_id" },
          );
          if (crErr) throw crErr;
        }

        let insightCount = 0;
        for (const level of ["campaign", "adset", "ad"] as const) {
          const rows = await fetchMetaInsights(
            provider,
            token,
            account.external_id,
            level,
            iso(since),
            iso(until),
          );
          for (let i = 0; i < rows.length; i += 500) {
            const chunk = rows.slice(i, i + 500);
            const { error: insErr } = await context.supabase.from("ad_insights_daily").upsert(
              chunk.map((r) => ({
                brand_id: data.brandId,
                ad_account_id: account.id,
                level: r.level,
                entity_external_id: r.entityExternalId,
                stat_date: r.statDate,
                breakdown_kind: "none",
                breakdown_value: "",
                spend: r.spend,
                impressions: r.impressions,
                reach: r.reach,
                clicks: r.clicks,
                link_clicks: r.linkClicks,
                results: r.results,
                result_kind: r.resultKind,
                raw: r.raw as unknown as Record<string, never>,
              })),
              {
                onConflict:
                  "ad_account_id,level,entity_external_id,stat_date,breakdown_kind,breakdown_value",
              },
            );
            if (insErr) throw insErr;
          }
          insightCount += rows.length;
        }

        await context.supabase
          .from("ad_accounts")
          .update({
            sync_status: insightCount === 0 && entities.length === 0 ? "empty" : "loaded",
            sync_error: null,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", account.id);

        return { entities: entities.length, insights: insightCount, days };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Falha ao sincronizar dados da Meta.";
        await markFailure(message);
        throw new Error(message);
      }
    },
  );

// -------------------------------------------------------------------- Report

type SumBase = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  results: number;
};

const zero = (): SumBase => ({
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  linkClicks: 0,
  results: 0,
});

function add(target: SumBase, row: SumBase) {
  target.spend += row.spend;
  target.impressions += row.impressions;
  target.reach += row.reach;
  target.clicks += row.clicks;
  target.linkClicks += row.linkClicks;
  target.results += row.results;
}

export const getAdsReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReportInput.parse(input))
  .handler(async ({ data, context }): Promise<AdsReport> => {
    const { data: account, error: accErr } = await context.supabase
      .from("ad_accounts")
      .select("id, external_id, name, currency, last_synced_at, sync_status, sync_error")
      .eq("id", data.adAccountId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (accErr) throw accErr;

    const level: AdsLevel = data.level;
    const emptyReport: AdsReport = {
      account: null,
      range: { since: data.since, until: data.until },
      totals: EMPTY_METRICS,
      previous: null,
      series: [],
      rows: [],
      resultLabel: null,
      hasData: false,
    };
    if (!account) return emptyReport;

    const accountInfo = {
      id: account.id,
      externalId: account.external_id,
      name: account.name ?? null,
      currency: account.currency ?? "BRL",
      lastSyncedAt: account.last_synced_at ?? null,
      syncStatus: (account.sync_status as AdAccountRow["syncStatus"]) ?? "not_loaded",
      syncError: account.sync_error ?? null,
    };

    // Período anterior de mesmo tamanho, imediatamente antes do atual.
    const sinceDate = new Date(`${data.since}T00:00:00Z`);
    const untilDate = new Date(`${data.until}T00:00:00Z`);
    const spanDays = Math.max(
      1,
      Math.round((untilDate.getTime() - sinceDate.getTime()) / 86_400_000) + 1,
    );
    const prevUntil = new Date(sinceDate.getTime() - 86_400_000);
    const prevSince = new Date(prevUntil.getTime() - (spanDays - 1) * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const readRows = async (from: string, to: string) => {
      const { data: rows, error } = await context.supabase
        .from("ad_insights_daily")
        .select(
          "level, entity_external_id, stat_date, spend, impressions, reach, clicks, link_clicks, results, result_kind",
        )
        .eq("ad_account_id", account.id)
        .eq("level", level === "account" ? "campaign" : level)
        .eq("breakdown_kind", "none")
        .gte("stat_date", from)
        .lte("stat_date", to)
        .order("stat_date", { ascending: true })
        .limit(20000);
      if (error) throw error;
      return rows ?? [];
    };

    const current = await readRows(data.since, data.until);
    const previousRows = data.compare ? await readRows(iso(prevSince), iso(prevUntil)) : [];

    // Estrutura para nomear entidades e aplicar o filtro de pai.
    const entityLevel = level === "account" ? "campaign" : level;
    const { data: entities, error: entErr } = await context.supabase
      .from("ad_entities")
      .select("level, external_id, parent_external_id, name, objective, effective_status, status")
      .eq("ad_account_id", account.id)
      .eq("level", entityLevel)
      .limit(5000);
    if (entErr) throw entErr;
    const entityById = new Map((entities ?? []).map((e) => [e.external_id, e]));

    const allowed = (entityExternalId: string) => {
      if (!data.parentExternalId) return true;
      const e = entityById.get(entityExternalId);
      return e?.parent_external_id === data.parentExternalId;
    };

    const totals = zero();
    const prevTotals = zero();
    const seriesMap = new Map<string, SumBase>();
    const byEntity = new Map<string, SumBase>();
    const resultKinds = new Map<string, number>();

    for (const r of current) {
      if (!allowed(r.entity_external_id)) continue;
      const row: SumBase = {
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        reach: Number(r.reach ?? 0),
        clicks: Number(r.clicks ?? 0),
        linkClicks: Number(r.link_clicks ?? 0),
        results: Number(r.results ?? 0),
      };
      add(totals, row);
      const day = seriesMap.get(r.stat_date) ?? zero();
      add(day, row);
      seriesMap.set(r.stat_date, day);
      const ent = byEntity.get(r.entity_external_id) ?? zero();
      add(ent, row);
      byEntity.set(r.entity_external_id, ent);
      if (r.result_kind) {
        resultKinds.set(r.result_kind, (resultKinds.get(r.result_kind) ?? 0) + row.results);
      }
    }
    for (const r of previousRows) {
      if (!allowed(r.entity_external_id)) continue;
      add(prevTotals, {
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        reach: Number(r.reach ?? 0),
        clicks: Number(r.clicks ?? 0),
        linkClicks: Number(r.link_clicks ?? 0),
        results: Number(r.results ?? 0),
      });
    }

    // Criativos apenas quando a visão é de anúncios.
    let creativeByAd = new Map<
      string,
      {
        title: string | null;
        body: string | null;
        thumbnail_url: string | null;
        image_url: string | null;
        link_url: string | null;
        call_to_action: string | null;
        video_id: string | null;
      }
    >();
    if (entityLevel === "ad" && byEntity.size) {
      const { data: creatives } = await context.supabase
        .from("ad_creatives")
        .select(
          "ad_external_id, title, body, thumbnail_url, image_url, link_url, call_to_action, video_id",
        )
        .eq("ad_account_id", account.id)
        .in("ad_external_id", [...byEntity.keys()].slice(0, 500));
      creativeByAd = new Map((creatives ?? []).map((c) => [c.ad_external_id, c]));
    }

    const rows: AdsRowItem[] = [...byEntity.entries()]
      .map(([externalId, sums]) => {
        const ent = entityById.get(externalId);
        const cr = creativeByAd.get(externalId);
        return {
          level: entityLevel as AdsLevel,
          externalId,
          parentExternalId: ent?.parent_external_id ?? null,
          name: ent?.name ?? externalId,
          status: ent?.effective_status ?? ent?.status ?? null,
          objective: ent?.objective ?? null,
          metrics: withDerived(sums),
          creative: cr
            ? {
                title: cr.title,
                body: cr.body,
                thumbnailUrl: cr.thumbnail_url,
                imageUrl: cr.image_url,
                linkUrl: cr.link_url,
                callToAction: cr.call_to_action,
                videoId: cr.video_id,
              }
            : null,
        } satisfies AdsRowItem;
      })
      .sort((a, b) => b.metrics.spend - a.metrics.spend);

    const series: AdsSeriesPoint[] = [...seriesMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, sums]) => ({ date, ...withDerived(sums) }));

    const topKind = [...resultKinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      account: accountInfo,
      range: { since: data.since, until: data.until },
      totals: withDerived(totals),
      previous: data.compare ? withDerived(prevTotals) : null,
      series,
      rows,
      resultLabel: resultLabelFor(topKind),
      hasData: current.length > 0,
    };
  });
