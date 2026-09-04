/**
 * Teardown determinístico de identidades de QA.
 *
 * Roda mesmo quando os testes falham (afterAll do setupFile), garantindo que
 * nenhuma conta de teste — privilegiada ou não — persista após a suíte.
 */
import { afterAll } from "vitest";
import { cleanupTestIdentities } from "./fixtures";

afterAll(async () => {
  await cleanupTestIdentities();
}, 120_000);
