import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TagInput } from "@/components/ui/tag-input";
import { saveArtifactVersionFn } from "@/lib/ai-agents.functions";

type Scope = { brandId: string; clientId: string };
type EntityType = "voice" | "personas" | "cohorts" | "swot";

function useSaveArtifact(
  scope: Scope,
  entityType: EntityType,
  entityId: string | undefined,
  onClose: () => void,
) {
  const qc = useQueryClient();
  const save = useServerFn(saveArtifactVersionFn);
  return useMutation({
    mutationFn: (data: unknown) => {
      if (!entityId) throw new Error("Registro ainda não gerado. Rode a IA antes de editar.");
      return save({
        data: { brandId: scope.brandId, clientId: scope.clientId, entityType, entityId, data },
      });
    },
    onSuccess: () => {
      toast.success("Alterações salvas");
      qc.invalidateQueries({ queryKey: ["customer-core", scope.brandId, scope.clientId] });
      qc.invalidateQueries({ queryKey: ["customer-target", scope.brandId, scope.clientId] });
      qc.invalidateQueries({ queryKey: ["customer-market", scope.brandId, scope.clientId] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });
}

// ---------- Voice Editor ----------

export type VoiceState = {
  brand_personality: string;
  tone_characteristics: string[];
  words_to_use: string[];
  words_to_avoid: string[];
  brand_phrases_examples: string[];
};

export function VoiceEditor({
  open,
  onClose,
  scope,
  entityId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  scope: Scope;
  entityId?: string;
  initial: VoiceState;
}) {
  const [s, setS] = useState<VoiceState>(initial);
  useEffect(() => {
    if (open) setS(initial);
  }, [open, initial]);
  const mut = useSaveArtifact(scope, "voice", entityId, onClose);

  const submit = () =>
    mut.mutate({
      brand_personality: s.brand_personality.trim(),
      tone_characteristics: s.tone_characteristics,
      vocabulary_rules: {
        words_to_use: s.words_to_use,
        words_to_avoid: s.words_to_avoid,
      },
      brand_phrases_examples: s.brand_phrases_examples,
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar tom de voz e vocabulário</DialogTitle>
          <DialogDescription>Corrija ou complemente o voice card gerado pela IA.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <Label>Personalidade da marca</Label>
            <Textarea
              rows={4}
              value={s.brand_personality}
              onChange={(e) => setS({ ...s, brand_personality: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Características do tom</Label>
            <TagInput
              value={s.tone_characteristics}
              onChange={(v) => setS({ ...s, tone_characteristics: v })}
              tone="info"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Termos preferidos</Label>
              <TagInput
                value={s.words_to_use}
                onChange={(v) => setS({ ...s, words_to_use: v })}
                tone="success"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Palavras proibidas</Label>
              <TagInput
                value={s.words_to_avoid}
                onChange={(v) => setS({ ...s, words_to_avoid: v })}
                tone="danger"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Frases assinatura</Label>
            <TagInput
              value={s.brand_phrases_examples}
              onChange={(v) => setS({ ...s, brand_phrases_examples: v })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mut.isPending || !entityId} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Personas Editor ----------

export type PersonaState = {
  nome: string;
  arquetipo: string;
  descricao: string;
  motivacao: string;
  dor_principal: string;
  dores: string[];
  canais_preferidos: string[];
  logica_compra: string;
  fator_confianca: string;
  como_decide: string;
  objecao_dominante: string;
  estilo_comunicacao: string;
  ciclo_compra: string;
  nivel_consciencia: string;
};

const EMPTY_PERSONA: PersonaState = {
  nome: "",
  arquetipo: "",
  descricao: "",
  motivacao: "",
  dor_principal: "",
  dores: [],
  canais_preferidos: [],
  logica_compra: "",
  fator_confianca: "",
  como_decide: "",
  objecao_dominante: "",
  estilo_comunicacao: "",
  ciclo_compra: "",
  nivel_consciencia: "",
};

export function PersonasEditor({
  open,
  onClose,
  scope,
  entityId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  scope: Scope;
  entityId?: string;
  initial: PersonaState[];
}) {
  const [list, setList] = useState<PersonaState[]>(initial.length ? initial : [EMPTY_PERSONA]);
  useEffect(() => {
    if (open) setList(initial.length ? initial : [EMPTY_PERSONA]);
  }, [open, initial]);
  const mut = useSaveArtifact(scope, "personas", entityId, onClose);

  const upd = (i: number, patch: Partial<PersonaState>) =>
    setList((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Editar personas</DialogTitle>
          <DialogDescription>
            Ajuste, adicione ou remova personas. As alterações substituem o output atual da IA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {list.map((p, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Persona {i + 1}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setList((prev) => prev.filter((_, j) => j !== i))}
                  disabled={list.length === 1}
                  className="h-7 gap-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remover
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome">
                  <Input value={p.nome} onChange={(e) => upd(i, { nome: e.target.value })} />
                </Field>
                <Field label="Arquétipo">
                  <Input
                    value={p.arquetipo}
                    onChange={(e) => upd(i, { arquetipo: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Perfil / descrição">
                <Textarea
                  rows={2}
                  value={p.descricao}
                  onChange={(e) => upd(i, { descricao: e.target.value })}
                />
              </Field>
              <Field label="Motivação principal">
                <Textarea
                  rows={2}
                  value={p.motivacao}
                  onChange={(e) => upd(i, { motivacao: e.target.value })}
                />
              </Field>
              <Field label="Dor principal">
                <Input
                  value={p.dor_principal}
                  onChange={(e) => upd(i, { dor_principal: e.target.value })}
                />
              </Field>
              <Field label="Todas as dores mapeadas">
                <TagInput value={p.dores} onChange={(v) => upd(i, { dores: v })} tone="danger" />
              </Field>
              <Field label="Canais preferidos">
                <TagInput
                  value={p.canais_preferidos}
                  onChange={(v) => upd(i, { canais_preferidos: v })}
                />
              </Field>
              <Field label="Lógica de compra">
                <Textarea
                  rows={2}
                  value={p.logica_compra}
                  onChange={(e) => upd(i, { logica_compra: e.target.value })}
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Fator de confiança">
                  <Input
                    value={p.fator_confianca}
                    onChange={(e) => upd(i, { fator_confianca: e.target.value })}
                  />
                </Field>
                <Field label="Como decide">
                  <Input
                    value={p.como_decide}
                    onChange={(e) => upd(i, { como_decide: e.target.value })}
                  />
                </Field>
                <Field label="Objeção dominante">
                  <Input
                    value={p.objecao_dominante}
                    onChange={(e) => upd(i, { objecao_dominante: e.target.value })}
                  />
                </Field>
                <Field label="Estilo de comunicação">
                  <Input
                    value={p.estilo_comunicacao}
                    onChange={(e) => upd(i, { estilo_comunicacao: e.target.value })}
                  />
                </Field>
                <Field label="Ciclo de compra">
                  <Input
                    value={p.ciclo_compra}
                    onChange={(e) => upd(i, { ciclo_compra: e.target.value })}
                  />
                </Field>
                <Field label="Nível de consciência">
                  <Input
                    value={p.nivel_consciencia}
                    onChange={(e) => upd(i, { nivel_consciencia: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={() => setList((p) => [...p, EMPTY_PERSONA])}
            className="w-full gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar persona
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => mut.mutate({ personas: list })}
            disabled={mut.isPending || !entityId}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" /> Salvar personas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Cohorts Editor ----------

export type CohortState = {
  name: string;
  target_personas: string[];
  behavioral_traits: string;
  content_strategy: string;
  conversion_criteria: string;
};

const EMPTY_COHORT: CohortState = {
  name: "",
  target_personas: [],
  behavioral_traits: "",
  content_strategy: "",
  conversion_criteria: "",
};

export function CohortsEditor({
  open,
  onClose,
  scope,
  entityId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  scope: Scope;
  entityId?: string;
  initial: CohortState[];
}) {
  const [list, setList] = useState<CohortState[]>(initial.length ? initial : [EMPTY_COHORT]);
  useEffect(() => {
    if (open) setList(initial.length ? initial : [EMPTY_COHORT]);
  }, [open, initial]);
  const mut = useSaveArtifact(scope, "cohorts", entityId, onClose);

  const upd = (i: number, patch: Partial<CohortState>) =>
    setList((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar cohorts</DialogTitle>
          <DialogDescription>
            Grupos comportamentais para segmentação de conteúdo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {list.map((c, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Cohort {i + 1}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={list.length === 1}
                  onClick={() => setList((prev) => prev.filter((_, j) => j !== i))}
                  className="h-7 gap-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remover
                </Button>
              </div>
              <Field label="Nome">
                <Input value={c.name} onChange={(e) => upd(i, { name: e.target.value })} />
              </Field>
              <Field label="Personas alvo">
                <TagInput
                  value={c.target_personas}
                  onChange={(v) => upd(i, { target_personas: v })}
                  tone="info"
                />
              </Field>
              <Field label="Traços comportamentais">
                <Textarea
                  rows={2}
                  value={c.behavioral_traits}
                  onChange={(e) => upd(i, { behavioral_traits: e.target.value })}
                />
              </Field>
              <Field label="Estratégia de conteúdo">
                <Textarea
                  rows={2}
                  value={c.content_strategy}
                  onChange={(e) => upd(i, { content_strategy: e.target.value })}
                />
              </Field>
              <Field label="Critério de conversão">
                <Textarea
                  rows={2}
                  value={c.conversion_criteria}
                  onChange={(e) => upd(i, { conversion_criteria: e.target.value })}
                />
              </Field>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={() => setList((p) => [...p, EMPTY_COHORT])}
            className="w-full gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar cohort
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => mut.mutate({ cohorts: list })}
            disabled={mut.isPending || !entityId}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" /> Salvar cohorts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- SWOT + Competitive Matrix Editor ----------

export type SwotState = {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  matrix: Array<{ competitor_name: string; our_advantages: string; vulnerabilities: string }>;
};

export function SwotEditor({
  open,
  onClose,
  scope,
  entityId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  scope: Scope;
  entityId?: string;
  initial: SwotState;
}) {
  const [s, setS] = useState<SwotState>(initial);
  useEffect(() => {
    if (open) setS(initial);
  }, [open, initial]);
  const mut = useSaveArtifact(scope, "swot", entityId, onClose);

  const submit = () =>
    mut.mutate({
      swot_analysis: {
        strengths: s.strengths,
        weaknesses: s.weaknesses,
        opportunities: s.opportunities,
        threats: s.threats,
      },
      competitive_matrix: s.matrix,
    });

  const updRow = (i: number, patch: Partial<SwotState["matrix"][number]>) =>
    setS((prev) => ({
      ...prev,
      matrix: prev.matrix.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Editar SWOT e matriz competitiva</DialogTitle>
          <DialogDescription>
            Ajuste os quatro quadrantes e o comparativo direto com concorrentes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-emerald-700 dark:text-emerald-400">Forças</Label>
              <TagInput
                value={s.strengths}
                onChange={(v) => setS({ ...s, strengths: v })}
                tone="success"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-amber-700 dark:text-amber-400">Fraquezas</Label>
              <TagInput value={s.weaknesses} onChange={(v) => setS({ ...s, weaknesses: v })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sky-700 dark:text-sky-400">Oportunidades</Label>
              <TagInput
                value={s.opportunities}
                onChange={(v) => setS({ ...s, opportunities: v })}
                tone="info"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-rose-700 dark:text-rose-400">Ameaças</Label>
              <TagInput
                value={s.threats}
                onChange={(v) => setS({ ...s, threats: v })}
                tone="danger"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Matriz competitiva</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setS((p) => ({
                    ...p,
                    matrix: [
                      ...p.matrix,
                      { competitor_name: "", our_advantages: "", vulnerabilities: "" },
                    ],
                  }))
                }
                className="h-7 gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Concorrente
              </Button>
            </div>
            {s.matrix.length ? (
              s.matrix.map((r, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={r.competitor_name}
                      placeholder="Nome"
                      onChange={(e) => updRow(i, { competitor_name: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setS((p) => ({ ...p, matrix: p.matrix.filter((_, j) => j !== i) }))
                      }
                      className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Field label="Nossas vantagens">
                    <Textarea
                      rows={2}
                      value={r.our_advantages}
                      onChange={(e) => updRow(i, { our_advantages: e.target.value })}
                    />
                  </Field>
                  <Field label="Vulnerabilidades deles">
                    <Textarea
                      rows={2}
                      value={r.vulnerabilities}
                      onChange={(e) => updRow(i, { vulnerabilities: e.target.value })}
                    />
                  </Field>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum concorrente comparado ainda.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mut.isPending || !entityId} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> Salvar SWOT
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- helpers ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
