import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  localDateTimeToUtc,
  nextRecurringRun,
  previewAutomationMessage,
} from "../src/lib/whatsapp/automation";

describe("automações de WhatsApp", () => {
  it("interpreta horário no fuso oficial e armazena UTC", () => {
    expect(localDateTimeToUtc("2026-09-15T09:00")?.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("calcula a próxima recorrência sem reutilizar o instante anterior", () => {
    const next = nextRecurringRun(
      { frequency: "daily", hour: 9, minute: 0 },
      new Date("2026-09-15T12:00:00.000Z"),
    );
    expect(next?.toISOString()).toBe("2026-09-16T12:00:00.000Z");
  });

  it("detecta variáveis fora do catálogo antes da ativação", () => {
    expect(previewAutomationMessage("Oi {{client.name}} {{secret.token}}").unknown).toEqual([
      "secret.token",
    ]);
  });

  it("usa o serviço único e autenticação de cron", () => {
    const worker = fs.readFileSync(path.resolve("src/lib/whatsapp/automation-worker.server.ts"), "utf8");
    const route = fs.readFileSync(path.resolve("src/routes/api/public/cron/whatsapp-automations.ts"), "utf8");
    expect(worker).toContain("sendWhatsappToRecipients");
    expect(worker).not.toContain("evolutionRequest");
    expect(route).toContain("assertCronRequest(request)");
  });
});