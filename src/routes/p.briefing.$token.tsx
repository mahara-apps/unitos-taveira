import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicBriefing, submitPublicBriefing } from "@/lib/briefing-tokens.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ArrowRight, ArrowLeft, CheckCircle2, Lock, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/p/briefing/$token")({
  head: () => ({
    meta: [
      { title: "Briefing da marca" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Compartilhe as informações essenciais da sua marca." },
      { property: "og:title", content: "Briefing da marca" },
      { property: "og:description", content: "Compartilhe as informações essenciais da sua marca." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params }) => {
    const info = await getPublicBriefing({ data: { token: params.token } });
    if (!info.ok && info.reason === "not_found") throw notFound();
    return { info };
  },
  errorComponent: () => (
    <ShellError title="Algo deu errado" body="Atualize a página e tente novamente." />
  ),
  notFoundComponent: () => (
    <ShellError
      title="Este link de briefing não está mais ativo."
      body="O link acessado não existe."
    />
  ),
  component: BriefingPage,
});

function ShellError({ title, body }: { title: string; body: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <BackgroundOrbs />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl backdrop-blur-2xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
            <Lock className="h-5 w-5 text-zinc-300" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-zinc-400">{body}</p>
        </div>
      </div>
    </div>
  );
}

function BackgroundOrbs() {
  return (
    <>
      <div className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-emerald-500/20 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-indigo-500/20 blur-[140px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(255,255,255,0.06),transparent_60%)]" />
    </>
  );
}

function BriefingPage() {
  const { info } = Route.useLoaderData();
  const { token } = Route.useParams();

  if (!info.ok) {
    const title =
      info.reason === "revoked"
        ? "Este link de briefing foi revogado."
        : info.reason === "expired"
          ? "Este link de briefing expirou."
          : "Este link de briefing não está mais ativo.";
    return (
      <ShellError title={title} body="Fale com a equipe responsável para solicitar um novo convite." />
    );
  }

  if (info.alreadySubmitted) {
    return <ThankYou brandName={info.brandName} />;
  }

  return <BriefingForm token={token} clientName={info.clientName} brandName={info.brandName} />;
}

const TONE_SUGGESTIONS = [
  "Profissional",
  "Divertido",
  "Ousado",
  "Minimalista",
  "Acolhedor",
  "Técnico",
  "Inspirador",
  "Amigável",
  "Confiante",
  "Educativo",
];

function BriefingForm({
  token,
  clientName,
  brandName,
}: {
  token: string;
  clientName: string;
  brandName: string;
}) {
  const submit = useServerFn(submitPublicBriefing);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [tones, setTones] = useState<string[]>([]);
  const [toneInput, setToneInput] = useState("");

  const steps = ["Visão do negócio", "Público-alvo", "Tom de voz"] as const;
  const canNext =
    (step === 0 && description.trim().length >= 20) ||
    (step === 1 && audience.trim().length >= 10) ||
    (step === 2 && tones.length >= 1);

  const addTone = (t: string) => {
    const clean = t.trim();
    if (!clean) return;
    if (tones.includes(clean)) return;
    if (tones.length >= 12) return;
    setTones((prev) => [...prev, clean]);
    setToneInput("");
  };

  const handleSubmit = async () => {
    if (!canNext) return;
    setSubmitting(true);
    try {
      await submit({
        data: {
          token,
          description: description.trim(),
          audience: audience.trim(),
          pain_points: painPoints.trim(),
          tone_tags: tones,
        },
      });
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) return <ThankYou brandName={brandName} />;

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <BackgroundOrbs />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
              <Sparkles className="h-4 w-4 text-emerald-300" />
            </div>
            <div className="text-xs text-zinc-400">
              <span className="font-mono">{brandName}</span> · briefing da marca
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-white/10 bg-white/[0.03] font-mono text-[10px] text-zinc-400"
          >
            link seguro
          </Badge>
        </header>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Olá, <span className="text-emerald-300">{clientName}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Responda três perguntas rápidas para a equipe criar conteúdos alinhados à sua marca.
          </p>
        </div>

        <div className="mb-8 flex items-center gap-2">
          {steps.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-emerald-500/70" : "bg-white/[0.06]"
                }`}
              />
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-2xl">
          <div className="mb-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              etapa {step + 1} de {steps.length}
            </div>
            <div className="mt-1 text-lg font-semibold">{steps[step]}</div>
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <Label htmlFor="desc" className="text-xs text-zinc-400">
                O que sua empresa faz e o que a torna diferente?
              </Label>
              <Textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={7}
                placeholder="Ajudamos nosso público a alcançar resultados por meio de…"
                className="border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
              />
              <div className="text-right font-mono text-[10px] text-zinc-500">
                {description.trim().length}/5000 · min 20
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-3">
                <Label htmlFor="aud" className="text-xs text-zinc-400">
                   Com quem sua marca fala? (idade, função e contexto)
                </Label>
                <Textarea
                  id="aud"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  rows={5}
                   placeholder="Empreendedores e líderes de marketing, principalmente entre 28 e 42 anos…"
                  className="border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
                />
              </div>
              <div className="space-y-3">
                <Label htmlFor="pain" className="text-xs text-zinc-400">
                   Principais dificuldades desse público (opcional)
                </Label>
                <Textarea
                  id="pain"
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  rows={3}
                   placeholder="Falta tempo para produzir conteúdo consistente e manter o tom da marca…"
                  className="border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Label className="text-xs text-zinc-400">
                 Escolha ou digite palavras que descrevem a voz da marca
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {TONE_SUGGESTIONS.map((t) => {
                  const on = tones.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => (on ? setTones(tones.filter((x) => x !== t)) : addTone(t))}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                          : "border-white/10 bg-white/[0.02] text-zinc-300 hover:bg-white/[0.05]"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={toneInput}
                  onChange={(e) => setToneInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTone(toneInput);
                    }
                  }}
                  placeholder="Adicionar tom personalizado…"
                  className="h-9 border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addTone(toneInput)}
                  className="border-white/10 bg-white/[0.02]"
                >
                  Adicionar
                </Button>
              </div>
              {tones.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
                  {tones.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => setTones(tones.filter((x) => x !== t))}
                        className="rounded-full p-0.5 hover:bg-white/10"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="text-right font-mono text-[10px] text-zinc-500">
                {tones.length}/12 · min 1
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0 || submitting}
              className="text-zinc-400 hover:bg-white/[0.04]"
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
            {step < steps.length - 1 ? (
              <Button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                className="bg-emerald-500/90 text-emerald-950 hover:bg-emerald-400"
              >
                Continuar <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canNext || submitting}
                className="bg-emerald-500/90 text-emerald-950 hover:bg-emerald-400"
              >
                {submitting ? "Enviando…" : "Enviar briefing"}
              </Button>
            )}
          </div>
        </div>

        <footer className="mt-8 text-center font-mono text-[10px] text-zinc-500">
          Sua resposta é protegida durante o envio e compartilhada somente com {brandName}.
        </footer>
      </div>
    </div>
  );
}

function ThankYou({ brandName }: { brandName: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <BackgroundOrbs />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center shadow-2xl backdrop-blur-2xl">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-300" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Obrigado</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Seu briefing foi enviado para <span className="text-zinc-200">{brandName}</span>. A
            equipe entrará em contato em breve.
          </p>
        </div>
      </div>
    </div>
  );
}
