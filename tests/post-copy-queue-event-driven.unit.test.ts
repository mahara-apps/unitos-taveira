import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cronFiles = [
  "supabase/install/020_cron.sql",
  "supabase/baseline-snapshot/002_bootstrap_cron.sql",
];

describe("fila de legendas acionada por evento", () => {
  it("nenhuma instalação agenda a checagem por minuto de legendas", () => {
    for (const file of cronFiles) {
      const sql = readFileSync(file, "utf8");
      expect(sql).not.toContain("'post-content-resume'");
    }
  });

  it("o relatório de saúde valida trigger e retomada sob demanda", () => {
    const sql = readFileSync("supabase/install/verify-installation.sql", "utf8");
    expect(sql).toContain("trg_post_copy_queue_notify");
    expect(sql).toContain("public.post_copy_queue_drain_on()");
    expect(sql).toContain("public.post_copy_queue_drain_off()");
  });

  it("o endpoint de retomada liga/desliga a varredura conforme a fila", () => {
    const code = readFileSync("src/routes/api/public/hooks/resume-post-content.ts", "utf8");
    expect(code).toContain("post_copy_queue_drain_off");
    expect(code).toContain("post_copy_queue_drain_on");
    expect(code).toContain("result.queueEmpty");
  });

  it("o pacote MASTER cria o disparo por evento", () => {
    const delta = readFileSync("supabase/baseline-snapshot/007_delta_migrations.sql", "utf8");
    expect(delta).toContain("post_copy_queue_notify");
    expect(delta).toContain("post_copy_queue_state");
  });
});
