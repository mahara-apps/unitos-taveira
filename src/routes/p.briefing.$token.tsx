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
      { title: "Brand briefing" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Share your brand parameters." },
    ],
  }),
  loader: async ({ params }) => {
    const info = await getPublicBriefing({ data: { token: params.token } });
    if (!info.ok && info.reason === "not_found") throw notFound();
    return { info };
  },
  errorComponent: () => (
    <ShellError title="Something went wrong" body="Please try refreshing the page." />
  ),
  notFoundComponent: () => (
    <ShellError
      title="This briefing link is no longer active."
      body="The link you followed does not exist."
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
        ? "This briefing link has been revoked."
        : info.reason === "expired"
          ? "This briefing link has expired."
          : "This briefing link is no longer active.";
    return (
      <ShellError title={title} body="Contact your account manager to request a new invitation." />
    );
  }

  if (info.alreadySubmitted) {
    return <ThankYou brandName={info.brandName} />;
  }

  return <BriefingForm token={token} clientName={info.clientName} brandName={info.brandName} />;
}

const TONE_SUGGESTIONS = [
  "Professional",
  "Playful",
  "Bold",
  "Minimal",
  "Warm",
  "Technical",
  "Aspirational",
  "Friendly",
  "Confident",
  "Educational",
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

  const steps = ["Business overview", "Target audience", "Tone of voice"] as const;
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
      toast.error(e instanceof Error ? e.message : "Submission failed. Please try again.");
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
              <span className="font-mono">{brandName}</span> · brand briefing
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-white/10 bg-white/[0.03] font-mono text-[10px] text-zinc-400"
          >
            secure link
          </Badge>
        </header>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome, <span className="text-emerald-300">{clientName}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Answer three quick questions so the team can start building content aligned with your
            brand.
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
              step {step + 1} of {steps.length}
            </div>
            <div className="mt-1 text-lg font-semibold">{steps[step]}</div>
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <Label htmlFor="desc" className="text-xs text-zinc-400">
                What does your business do, and what makes it different?
              </Label>
              <Textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={7}
                placeholder="We help X do Y through Z. Founded in 2019, we specialize in…"
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
                  Who are you talking to? (age, role, context)
                </Label>
                <Textarea
                  id="aud"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  rows={5}
                  placeholder="Founders and marketing leads at Series A-B startups, mostly 28-42…"
                  className="border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
                />
              </div>
              <div className="space-y-3">
                <Label htmlFor="pain" className="text-xs text-zinc-400">
                  Pain points they struggle with (optional)
                </Label>
                <Textarea
                  id="pain"
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  rows={3}
                  placeholder="They lack time to produce consistent content and struggle with tone…"
                  className="border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Label className="text-xs text-zinc-400">
                Pick or type words that describe your voice
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
                  placeholder="Add custom tone…"
                  className="h-9 border-white/10 bg-white/[0.02] text-sm focus-visible:ring-emerald-500/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addTone(toneInput)}
                  className="border-white/10 bg-white/[0.02]"
                >
                  Add
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
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {step < steps.length - 1 ? (
              <Button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                className="bg-emerald-500/90 text-emerald-950 hover:bg-emerald-400"
              >
                Continue <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canNext || submitting}
                className="bg-emerald-500/90 text-emerald-950 hover:bg-emerald-400"
              >
                {submitting ? "Submitting…" : "Submit briefing"}
              </Button>
            )}
          </div>
        </div>

        <footer className="mt-8 text-center font-mono text-[10px] text-zinc-500">
          Your response is encrypted in transit and shared only with {brandName}.
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
          <h1 className="text-xl font-semibold tracking-tight">Thank you</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Your briefing has been delivered to <span className="text-zinc-200">{brandName}</span>.
            The team will be in touch shortly.
          </p>
        </div>
      </div>
    </div>
  );
}
