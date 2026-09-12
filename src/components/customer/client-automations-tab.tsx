import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Copy, History, MessageCircle, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ProfileSection } from "@/components/customer/ui/profile-ui";
import {
  deleteClientAutomation,
  listClientAutomations,
  saveClientAutomation,
  saveClientAutomationDate,
  setClientDefaultWhatsappRecipient,
} from "@/lib/whatsapp-automations.functions";
import { AUTOMATION_EVENTS, AUTOMATION_VARIABLES, previewAutomationMessage } from "@/lib/whatsapp/automation";
import { formatDateOnlyBr, formatDateTimeBr } from "@/lib/timezone";

type Rule = Record<string, any>;

const TRIGGER_LABEL: Record<string, string> = {
  fixed: "Data e hora fixa", recurring: "Recorrente", system_event: "Evento do sistema", client_date: "Data do cliente",
};
const STATUS_TONE: Record<string, "emerald" | "amber" | "red" | "blue" | "slate"> = {
  sent: "emerald", retry: "amber", failed: "red", processing: "blue", pending: "slate",
};

export function ClientAutomationsTab({ brandId, clientId, canManage }: { brandId: string; clientId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listClientAutomations);
  const saveFn = useServerFn(saveClientAutomation);
  const deleteFn = useServerFn(deleteClientAutomation);
  const defaultFn = useServerFn(setClientDefaultWhatsappRecipient);
  const dateFn = useServerFn(saveClientAutomationDate);
  const key = ["client-automations", brandId, clientId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => listFn({ data: { brandId, clientId } }) });
  const [open, setOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("fixed");
  const [eventKey, setEventKey] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [customDateId, setCustomDateId] = useState("");
  const [time, setTime] = useState("09:00");
  const [recipientId, setRecipientId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [message, setMessage] = useState("Olá {{client.contact_name}}, temos uma atualização para {{client.name}}.");
  const [active, setActive] = useState(true);
  const [dateName, setDateName] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [dateRepeats, setDateRepeats] = useState(true);
  const preview = useMemo(() => previewAutomationMessage(message), [message]);
  const data = q.data;
  const defaultRecipient = data?.recipients.find((item: any) => item.is_default);

  const reset = () => {
    setEditing(null); setName(""); setTriggerType("fixed"); setEventKey(""); setScheduledFor("");
    setFrequency("daily"); setCustomDateId(""); setTime("09:00");
    setRecipientId(defaultRecipient?.id ?? ""); setInstanceId(data?.instances[0]?.id ?? "");
    setMessage("Olá {{client.contact_name}}, temos uma atualização para {{client.name}}."); setActive(true);
  };
  const edit = (rule: Rule) => {
    setEditing(rule); setName(rule.name); setTriggerType(rule.trigger_type); setEventKey(rule.event_key ?? "");
    setScheduledFor(rule.schedule_config?.scheduledFor ?? ""); setFrequency(rule.schedule_config?.frequency ?? "daily");
    setCustomDateId(rule.custom_date_id ?? "");
    setTime(`${String(rule.schedule_config?.hour ?? 9).padStart(2, "0")}:${String(rule.schedule_config?.minute ?? 0).padStart(2, "0")}`);
    setRecipientId(rule.recipient_id); setInstanceId(rule.instance_id); setMessage(rule.message_template); setActive(rule.is_active); setOpen(true);
  };
  const duplicate = (rule: Rule) => {
    edit(rule);
    setEditing(null);
    setName(`${rule.name} — cópia`);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => {
      const [hour, minute] = time.split(":").map(Number);
      return saveFn({ data: { brandId, clientId, id: editing?.id, name, triggerType: triggerType as any,
        eventKey: eventKey || null, customDateId: customDateId || null, scheduledFor: scheduledFor || null,
        frequency: frequency as any, hour, minute, messageTemplate: message, recipientId, instanceId, isActive: active } });
    },
    onSuccess: () => { toast.success("Automação salva."); setOpen(false); reset(); refresh(); },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Falha ao salvar."),
  });
  const remove = useMutation({ mutationFn: (ruleId: string) => deleteFn({ data: { brandId, clientId, ruleId } }), onSuccess: () => { toast.success("Automação excluída."); refresh(); } });
  const setDefault = useMutation({ mutationFn: (id: string) => defaultFn({ data: { brandId, clientId, recipientId: id } }), onSuccess: () => { toast.success("Destino padrão atualizado."); refresh(); } });
  const saveDate = useMutation({ mutationFn: () => dateFn({ data: { brandId, clientId, name: dateName, dateValue, sendTime: time, repeatsAnnually: dateRepeats } }), onSuccess: () => { toast.success("Data cadastrada."); setDateOpen(false); setDateName(""); setDateValue(""); refresh(); } });
  const canSave = canManage && name.trim().length >= 2 && recipientId && instanceId && !preview.unknown.length && message.trim() && ((triggerType === "fixed" && scheduledFor) || (triggerType === "system_event" && eventKey) || (triggerType === "client_date" && customDateId) || triggerType === "recurring");

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando automações…</p>;
  if (q.error) return <p className="text-sm text-destructive">Não foi possível carregar as automações.</p>;
  return <div className="space-y-6">
    <ProfileSection title="Destino padrão" subtitle="Um telefone ou grupo por cliente" icon={<MessageCircle className="h-4 w-4" />}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5"><Label>Destino</Label><Select value={defaultRecipient?.id ?? ""} onValueChange={(value) => setDefault.mutate(value)} disabled={!canManage}><SelectTrigger><SelectValue placeholder="Selecione um destino" /></SelectTrigger><SelectContent>{data?.recipients.map((item: any) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.type === "whatsapp_group" ? "Grupo" : "Telefone"}</SelectItem>)}</SelectContent></Select></div>
        {canManage && <Button variant="outline" onClick={() => setDateOpen(true)}><CalendarDays className="mr-2 h-4 w-4" />Nova data</Button>}
      </div>
      {!data?.recipients.length && <p className="mt-3 text-xs text-muted-foreground">Cadastre primeiro um telefone ou grupo na seção de WhatsApp da conta do cliente.</p>}
    </ProfileSection>

    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Regras de automação</h2><p className="text-sm text-muted-foreground">Disparos únicos, recorrentes, por evento ou data do cliente.</p></div>{canManage && <Button onClick={() => { reset(); setOpen(true); }} disabled={!data?.recipients.length || !data?.instances.length}><Plus className="mr-2 h-4 w-4" />Nova automação</Button>}</div>
      {!data?.instances.length && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">Conecte uma instância de WhatsApp antes de ativar automações.</div>}
      {!data?.rules.length ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"><Zap className="mx-auto mb-2 h-5 w-5" />Nenhuma automação configurada.</div> : <div className="divide-y rounded-lg border">{data.rules.map((rule: any) => <div key={rule.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate font-medium">{rule.name}</p><Badge tone={rule.is_active ? "emerald" : "slate"}>{rule.is_active ? "Ativa" : "Pausada"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{TRIGGER_LABEL[rule.trigger_type]}{rule.next_run_at ? ` · Próximo: ${formatDateTimeBr(rule.next_run_at)}` : ""}</p></div>{canManage && <div className="flex gap-1"><Button variant="ghost" size="icon" aria-label="Duplicar automação" onClick={() => duplicate(rule)}><Copy className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label="Editar automação" onClick={() => edit(rule)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label="Excluir automação" onClick={() => remove.mutate(rule.id)}><Trash2 className="h-4 w-4" /></Button></div>}</div>)}</div>}
    </section>

    <ProfileSection title="Histórico" subtitle="Últimas ocorrências e tentativas" icon={<History className="h-4 w-4" />}>
      {!data?.dispatches.length ? <p className="text-sm text-muted-foreground">Nenhum disparo registrado.</p> : <div className="divide-y">{data.dispatches.map((item: any) => <div key={item.id} className="flex items-start justify-between gap-3 py-3"><div><p className="text-sm font-medium">{formatDateTimeBr(item.sent_at ?? item.scheduled_at)}</p><p className="text-xs text-muted-foreground">Tentativa {item.attempts}{item.last_error ? ` · ${item.last_error}` : ""}</p></div><Badge tone={STATUS_TONE[item.status] ?? "slate"}>{item.status}</Badge></div>)}</div>}
    </ProfileSection>

    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}><DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-[620px]"><DialogHeader><DialogTitle>{editing ? "Editar automação" : "Nova automação"}</DialogTitle></DialogHeader><div className="grid gap-4">
      <div className="space-y-1.5"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lembrete de aprovação" /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Gatilho</Label><Select value={triggerType} onValueChange={setTriggerType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TRIGGER_LABEL).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      {triggerType === "system_event" && <div className="space-y-1.5"><Label>Evento</Label><Select value={eventKey} onValueChange={setEventKey}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{AUTOMATION_EVENTS.map((event) => <SelectItem key={event.key} value={event.key}>{event.label}</SelectItem>)}</SelectContent></Select></div>}
      {triggerType === "fixed" && <div className="space-y-1.5"><Label>Data e hora</Label><Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} /></div>}
      {triggerType === "recurring" && <div className="space-y-1.5"><Label>Recorrência</Label><Select value={frequency} onValueChange={setFrequency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Diária</SelectItem><SelectItem value="weekly">Semanal</SelectItem><SelectItem value="monthly">Mensal</SelectItem><SelectItem value="yearly">Anual</SelectItem></SelectContent></Select></div>}
      {triggerType === "client_date" && <div className="space-y-1.5"><Label>Data do cliente</Label><Select value={customDateId} onValueChange={setCustomDateId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{data?.dates.map((date: any) => <SelectItem key={date.id} value={date.id}>{date.name} · {formatDateOnlyBr(date.date_value)}</SelectItem>)}</SelectContent></Select></div>}</div>
      {(triggerType === "recurring" || triggerType === "client_date") && <div className="space-y-1.5"><Label>Horário</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>}
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Destino</Label><Select value={recipientId} onValueChange={setRecipientId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{data?.recipients.map((item: any) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>Conexão</Label><Select value={instanceId} onValueChange={setInstanceId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{data?.instances.map((item: any) => <SelectItem key={item.id} value={item.id}>{item.label || item.instance_name}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="space-y-1.5"><Label>Mensagem</Label><Textarea className="min-h-28" value={message} onChange={(e) => setMessage(e.target.value)} /><div className="flex flex-wrap gap-1">{AUTOMATION_VARIABLES.map((variable) => <Button key={variable.key} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMessage((current) => `${current}${current ? " " : ""}{{${variable.key}}}`)}>{variable.label}</Button>)}</div>{preview.unknown.length > 0 && <p className="text-xs text-destructive">Variáveis inválidas: {preview.unknown.join(", ")}</p>}</div>
      <div className="rounded-lg border bg-muted/20 p-3"><p className="mb-1 text-xs font-medium text-muted-foreground">Prévia</p><p className="whitespace-pre-wrap text-sm">{preview.message}</p></div>
      <label className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Ativar ao salvar</span><Switch checked={active} onCheckedChange={setActive} /></label>
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={dateOpen} onOpenChange={setDateOpen}><DialogContent className="sm:max-w-[440px]"><DialogHeader><DialogTitle>Nova data do cliente</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label>Nome da data</Label><Input value={dateName} onChange={(e) => setDateName(e.target.value)} placeholder="Ex.: Renovação do contrato" /></div><div className="space-y-1.5"><Label>Data</Label><Input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} /></div><label className="flex items-center justify-between"><span className="text-sm">Repetir todos os anos</span><Switch checked={dateRepeats} onCheckedChange={setDateRepeats} /></label></div><DialogFooter><Button variant="outline" onClick={() => setDateOpen(false)}>Cancelar</Button><Button onClick={() => saveDate.mutate()} disabled={dateName.trim().length < 2 || !dateValue || saveDate.isPending}>Salvar data</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}