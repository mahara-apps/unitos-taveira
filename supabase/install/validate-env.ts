/**
 * Etapa 0 do bootstrap — validação READ-ONLY do ambiente da instalação.
 * Não toca banco, não escreve arquivos, não imprime valores de secrets.
 *
 * Uso: bun supabase/install/validate-env.ts
 * Saída: relatório PASS/FAIL + `APP_ORIGIN=<origem>` na última linha em caso de PASS.
 * Exit code 0 = PASS, 1 = FAIL.
 */

import {
  containsMasterReference,
  validateCronSecret,
  validatePublicAppUrl,
} from "../../src/lib/installation/bootstrap-contract";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];
const env = process.env;

const appUrl = validatePublicAppUrl(env["PUBLIC_APP_URL"]);
checks.push({
  name: "PUBLIC_APP_URL",
  ok: appUrl.ok,
  detail: appUrl.ok ? appUrl.value : appUrl.reason,
});

const cronSecret = validateCronSecret(env["CRON_SECRET"]);
checks.push({
  name: "CRON_SECRET",
  ok: cronSecret.ok,
  detail: cronSecret.ok ? "ok (valor não exibido)" : cronSecret.reason,
});

const required = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
  "BRAND_CREDENTIALS_SECRET",
  "META_STATE_SECRET",
];

for (const key of required) {
  const value = (env[key] ?? "").trim();
  checks.push({
    name: key,
    ok: value.length > 0,
    detail: value.length > 0 ? "presente" : "ausente",
  });
}

// Isolamento: nenhuma variável pode referenciar o MASTER.
const leaking = Object.entries(env)
  .filter(([key]) => key.startsWith("SUPABASE_") || key.startsWith("VITE_SUPABASE_") || key.startsWith("META_") || key === "PUBLIC_APP_URL")
  .filter(([, value]) => containsMasterReference(value))
  .map(([key]) => key);

checks.push({
  name: "isolamento do MASTER",
  ok: leaking.length === 0,
  detail: leaking.length === 0 ? "nenhuma referência ao MASTER" : `referências em: ${leaking.join(", ")}`,
});

// Coerência de projeto entre as variáveis do Supabase.
const serverRef = (env["SUPABASE_URL"] ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
const clientRef = (env["VITE_SUPABASE_URL"] ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
const declaredRef = (env["VITE_SUPABASE_PROJECT_ID"] ?? "").trim();
const sameProject = Boolean(serverRef) && serverRef === clientRef && (!declaredRef || declaredRef === serverRef);
checks.push({
  name: "coerência do projeto Supabase",
  ok: sameProject,
  detail: sameProject ? `ref=${serverRef}` : "SUPABASE_URL / VITE_SUPABASE_URL / VITE_SUPABASE_PROJECT_ID divergem",
});

let failed = 0;
for (const check of checks) {
  if (!check.ok) failed += 1;
  console.log(`${check.ok ? "PASS" : "FAIL"} | ${check.name} | ${check.detail}`);
}

if (failed > 0) {
  console.log(`\nRESULTADO: FAIL (${failed} verificação(ões))`);
  process.exit(1);
}

console.log("\nRESULTADO: PASS");
if (appUrl.ok) console.log(`APP_ORIGIN=${appUrl.value}`);
