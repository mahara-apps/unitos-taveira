import { useMemo, useState } from "react";

import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

import { ArrowLeft, ArrowRight, Check, Sparkles, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  interviewBudget,
  isQuestionAnswered,
  visibleQuestions,
  type InterviewAnswers,
  type InterviewQuestion,
} from "@/lib/media-plan/interview-schema";

export type InterviewResult = {
  answers: InterviewAnswers;
  monthlyBudget: number;
  funnelSplit: { topo: number; meio: number; fundo: number } | null;
};

type Props = {
  onSubmit: (result: InterviewResult) => void;
  onCancel: () => void;
  submitting?: boolean;
  submitLabel?: string;
};

/**
 * Entrevista guiada — uma pergunta por vez, em linguagem do dia a dia.
 * A divisão por etapa do funil fica escondida por padrão: quem quiser fixa
 * manualmente em "Ajuste avançado"; caso contrário a IA decide e explica.
 */
export function MediaPlanInterview({ onSubmit, onCancel, submitting, submitLabel }: Props) {
  const [answers, setAnswers] = useState<InterviewAnswers>({});
  const [step, setStep] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [split, setSplit] = useState({ topo: 30, meio: 40, fundo: 30 });
  // Entrevista em andamento não pode ser perdida por um recarregamento.
  useUnsavedGuard(Object.keys(answers).length > 0 && !submitting);

  const questions = useMemo(() => visibleQuestions(answers), [answers]);
  const index = Math.min(step, questions.length - 1);
  const current = questions[index] as InterviewQuestion | undefined;
  const isLast = index === questions.length - 1;
  const answered = current ? isQuestionAnswered(current, answers) : false;
  const progress = questions.length > 0 ? ((index + 1) / (questions.length + 1)) * 100 : 0;

  const set = (id: string, value: string | string[]) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const toggleMulti = (id: string, value: string) =>
    setAnswers((prev) => {
      const list = Array.isArray(prev[id]) ? [...(prev[id] as string[])] : [];
      const at = list.indexOf(value);
      if (at >= 0) list.splice(at, 1);
      else list.push(value);
      return { ...prev, [id]: list };
    });

  const [review, setReview] = useState(false);

  const goNext = () => {
    if (isLast) setReview(true);
    else setStep(index + 1);
  };
  const goBack = () => {
    if (review) setReview(false);
    else if (index === 0) onCancel();
    else setStep(index - 1);
  };

  const budget = interviewBudget(answers);

  const finish = () =>
    onSubmit({
      answers,
      monthlyBudget: budget,
      funnelSplit: advanced ? normalized(split) : null,
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${review ? 100 : progress}%` }}
        />
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        {review ? (
          <ReviewStep
            answers={answers}
            questions={questions}
            budget={budget}
            advanced={advanced}
            setAdvanced={setAdvanced}
            split={split}
            setSplit={setSplit}
            onEdit={(qIndex) => {
              setReview(false);
              setStep(qIndex);
            }}
          />
        ) : current ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pergunta {index + 1} de {questions.length}
              </div>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">{current.question}</h3>
              {current.help && <p className="mt-1 text-sm text-muted-foreground">{current.help}</p>}
            </div>

            {current.kind === "single" || current.kind === "multi" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(current.options ?? []).map((opt) => {
                  const value = answers[current.id];
                  const selected =
                    current.kind === "multi"
                      ? Array.isArray(value) && value.includes(opt.value)
                      : value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        current.kind === "multi"
                          ? toggleMulti(current.id, opt.value)
                          : set(current.id, opt.value)
                      }
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/60 bg-card hover:border-primary/40 hover:bg-accent/40",
                      )}
                    >
                      <span className="text-2xl leading-none">{opt.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{opt.label}</span>
                        {opt.hint && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {opt.hint}
                          </span>
                        )}
                      </span>
                      {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ) : current.kind === "money" ? (
              <div className="max-w-xs">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    R$
                  </span>
                  <Input
                    autoFocus
                    inputMode="decimal"
                    className="h-11 pl-9 text-lg"
                    placeholder={current.placeholder}
                    value={(answers[current.id] as string) ?? ""}
                    onChange={(e) => set(current.id, e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <Textarea
                autoFocus
                rows={4}
                placeholder={current.placeholder}
                value={(answers[current.id] as string) ?? ""}
                onChange={(e) => set(current.id, e.target.value)}
              />
            )}

            {current.kind === "multi" && (
              <p className="text-xs text-muted-foreground">Pode marcar mais de uma opção.</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
        <Button variant="ghost" onClick={goBack} disabled={submitting}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {review ? "Rever respostas" : index === 0 ? "Cancelar" : "Voltar"}
        </Button>
        {review ? (
          <Button onClick={finish} disabled={submitting || budget <= 0}>
            <Sparkles className="mr-2 h-4 w-4" />
            {submitting ? "Montando o plano..." : (submitLabel ?? "Gerar plano")}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {current?.optional && (
              <Button variant="ghost" onClick={goNext}>
                Pular
              </Button>
            )}
            <Button onClick={goNext} disabled={!answered}>
              Continuar
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function normalized(s: { topo: number; meio: number; fundo: number }) {
  const sum = s.topo + s.meio + s.fundo;
  if (sum <= 0) return { topo: 30, meio: 40, fundo: 30 };
  const k = 100 / sum;
  const topo = Math.round(s.topo * k);
  const meio = Math.round(s.meio * k);
  return { topo, meio, fundo: 100 - topo - meio };
}

function ReviewStep({
  answers,
  questions,
  budget,
  advanced,
  setAdvanced,
  split,
  setSplit,
  onEdit,
}: {
  answers: InterviewAnswers;
  questions: InterviewQuestion[];
  budget: number;
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
  split: { topo: number; meio: number; fundo: number };
  setSplit: (v: { topo: number; meio: number; fundo: number }) => void;
  onEdit: (index: number) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold tracking-tight">Confira antes de gerar</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Clique em qualquer resposta para corrigir. Com {formatBRL(budget)} por mês, a IA vai
          escolher as campanhas do Meta e do Google que fazem sentido.
        </p>
      </div>

      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {questions.map((q, i) => {
          const v = answers[q.id];
          const text = Array.isArray(v)
            ? v.map((x) => q.options?.find((o) => o.value === x)?.label ?? x).join(", ")
            : q.kind === "single"
              ? (q.options?.find((o) => o.value === v)?.label ?? "")
              : ((v as string) ?? "");
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onEdit(i)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{q.question}</span>
                <span className="mt-0.5 block truncate text-sm font-medium">
                  {text || "— não respondido"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border/60 p-3">
        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          className="flex w-full items-center gap-2 text-sm font-medium"
        >
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Ajuste avançado da estratégia
          <span className="ml-auto text-xs text-muted-foreground">
            {advanced ? "definido por você" : "a IA decide"}
          </span>
        </button>
        {advanced && (
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              Quanto da verba vai para cada momento da jornada: descobrir a marca, considerar a
              compra e comprar agora.
            </p>
            {(
              [
                ["topo", "Descobrir a marca"],
                ["meio", "Considerar a compra"],
                ["fundo", "Comprar agora"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <Label>{label}</Label>
                  <span className="tabular-nums text-muted-foreground">{split[key]}%</span>
                </div>
                <Slider
                  value={[split[key]]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([v]) => setSplit({ ...split, [key]: v ?? 0 })}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Os valores são normalizados para somar 100%.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}
