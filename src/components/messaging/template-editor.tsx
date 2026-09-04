import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bold,
  Eye,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Send,
  Braces,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  EVENTS,
  getEvent,
  getDefault,
  renderTemplateString,
  buildSampleContext,
  type Channel,
  type EventDef,
} from "@/lib/message-templates.catalog";
import {
  listTemplates,
  upsertTemplate,
  resetTemplate,
  sendTestMessage,
  type TemplateRecord,
} from "@/lib/message-templates.functions";

function templateKey(brandId: string) {
  return ["message-templates", brandId] as const;
}

function findRecord(rows: TemplateRecord[], eventKey: string, channel: Channel) {
  return rows.find((r) => r.event_key === eventKey && r.channel === channel);
}

const CATEGORY_ORDER = [
  "Time",
  "Cliente",
  "Portal",
  "Aprovação",
  "Produção",
  "Relatórios",
  "Financeiro",
] as const;

const CATEGORIES = CATEGORY_ORDER.filter((c) => EVENTS.some((e) => e.category === c));

/**
 * Área operacional de templates: lista com busca/filtro à esquerda,
 * editor do template selecionado à direita. Toda a lógica (queries e
 * server functions) é a existente — só a apresentação mudou.
 */
export function TemplatesWorkspace({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listTemplates);
  const upsert = useServerFn(upsertTemplate);
  const reset = useServerFn(resetTemplate);
  const sendTest = useServerFn(sendTestMessage);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: templateKey(brandId),
    queryFn: () => list({ data: { brandId } }),
    enabled: !!brandId,
  });

  const rows: TemplateRecord[] = data?.templates ?? [];

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string>(EVENTS[0]?.key ?? "");

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, EventDef[]>();
    for (const e of EVENTS) {
      if (category !== "all" && e.category !== category) continue;
      if (q && !`${e.name} ${e.description}`.toLowerCase().includes(q)) continue;
      if (!map.has(e.category)) map.set(e.category, []);
      map.get(e.category)!.push(e);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c as string,
      items: map.get(c)!,
    }));
  }, [search, category]);

  const selected = getEvent(selectedKey);
  const [channel, setChannel] = useState<Channel>((selected?.channels[0] as Channel) ?? "email");

  useEffect(() => {
    if (selected && !selected.channels.includes(channel)) setChannel(selected.channels[0]);
  }, [selectedKey, channel, selected]);

  if (isError) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-8 text-center">
        <p className="text-sm font-medium">Não foi possível carregar os templates.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Verifique sua conexão e tente novamente.
        </p>
        <Button size="sm" variant="outline" className="mt-4" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border/60 bg-card">
        <div className="space-y-2 border-b border-border/60 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar template"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Nenhum template encontrado.
          </div>
        ) : (
          <ScrollArea className="h-[420px] lg:h-[520px]">
            <div className="p-2">
              {grouped.map((g) => (
                <div key={g.category} className="mb-3">
                  <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    {g.category}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {g.items.map((ev) => {
                      const active = ev.key === selectedKey;
                      const overridden = ev.channels.some((c) =>
                        findRecord(rows, ev.key, c as Channel),
                      );
                      return (
                        <button
                          key={ev.key}
                          type="button"
                          onClick={() => setSelectedKey(ev.key)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                            active && "bg-accent font-medium",
                          )}
                        >
                          <span className="truncate">{ev.name}</span>
                          {overridden && (
                            <span
                              aria-label="Personalizado"
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </aside>

      <section className="rounded-xl border border-border/60 bg-card">
        {isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : selected ? (
          <EventEditor
            key={`${selected.key}-${channel}`}
            brandId={brandId}
            event={selected}
            channel={channel}
            onChangeChannel={setChannel}
            record={findRecord(rows, selected.key, channel)}
            onSaved={() => qc.invalidateQueries({ queryKey: templateKey(brandId) })}
            upsert={(payload) => upsert({ data: payload })}
            reset={(payload) => reset({ data: payload })}
            sendTest={(payload) => sendTest({ data: payload })}
          />
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Selecione um template na lista.
          </div>
        )}
      </section>
    </div>
  );
}

type EventEditorProps = {
  brandId: string;
  event: EventDef;
  channel: Channel;
  onChangeChannel: (c: Channel) => void;
  record?: TemplateRecord;
  onSaved: () => void;
  upsert: (payload: {
    brandId: string;
    eventKey: string;
    channel: Channel;
    subject?: string | null;
    body: string;
    isActive: boolean;
  }) => Promise<{ template: TemplateRecord }>;
  reset: (payload: {
    brandId: string;
    eventKey: string;
    channel: Channel;
  }) => Promise<{ ok: boolean }>;
  sendTest: (payload: {
    brandId: string;
    eventKey: string;
    channel: Channel;
    subject?: string | null;
    body: string;
    to: string;
  }) => Promise<{ sent: boolean; error?: string; previewSubject?: string; previewBody?: string }>;
};

function EventEditor({
  brandId,
  event,
  channel,
  onChangeChannel,
  record,
  onSaved,
  upsert,
  reset,
  sendTest,
}: EventEditorProps) {
  const defaults = getDefault(event.key, channel);
  const initialSubject = record?.subject ?? defaults?.subject ?? "";
  const initialBody = record?.body ?? defaults?.body ?? "";

  const [subject, setSubject] = useState<string>(initialSubject);
  const [saved, setSaved] = useState({ subject: initialSubject, body: initialBody });
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Escreva o conteúdo do template…" }),
    ],
    content: initialBody,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[220px] px-4 py-3 focus:outline-none",
      },
    },
    onUpdate: () => setDirty(true),
  });

  const currentBody = () =>
    channel === "email" ? (editor?.getHTML() ?? "") : (editor?.getText() ?? "");

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = currentBody();
      if (!body || body === "<p></p>") throw new Error("Conteúdo vazio.");
      return upsert({
        brandId,
        eventKey: event.key,
        channel,
        subject: channel === "email" ? subject : null,
        body,
        isActive: true,
      });
    },
    onSuccess: () => {
      setSaved({ subject, body: currentBody() });
      setDirty(false);
      toast.success("Template salvo");
      onSaved();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ brandId, eventKey: event.key, channel }),
    onSuccess: () => {
      const d = getDefault(event.key, channel);
      setSubject(d?.subject ?? "");
      editor?.commands.setContent(d?.body ?? "");
      setSaved({ subject: d?.subject ?? "", body: d?.body ?? "" });
      setDirty(false);
      toast.success("Template restaurado ao padrão");
      onSaved();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao restaurar"),
  });

  const testMut = useMutation({
    mutationFn: () => {
      if (!testTo.trim()) throw new Error("Informe um destinatário.");
      return sendTest({
        brandId,
        eventKey: event.key,
        channel,
        subject: channel === "email" ? subject : null,
        body: currentBody(),
        to: testTo.trim(),
      });
    },
    onSuccess: (r) => {
      if (r.sent) {
        toast.success("Mensagem de teste enviada");
        setTestOpen(false);
      } else {
        toast.error(r.error ? `Não enviado: ${r.error}` : "Não enviado");
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha no envio"),
  });

  const sampleCtx = useMemo(() => buildSampleContext(event), [event]);
  const isDirty = dirty || subject !== saved.subject;

  const insertVariable = (key: string) => {
    editor?.chain().focus().insertContent(`{{${key}}}`).run();
    setDirty(true);
  };

  return (
    <div className="flex flex-col">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 p-5">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{event.name}</h3>
            {isDirty && (
              <Badge
                variant="outline"
                className="shrink-0 border-severity-warning/40 bg-severity-warning/10 text-[10px] text-severity-warning"
              >
                Alterações não salvas
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{event.description}</p>
        </div>
        {event.channels.length > 1 ? (
          <Tabs value={channel} onValueChange={(v) => onChangeChannel(v as Channel)}>
            <TabsList>
              {event.channels.map((c) => (
                <TabsTrigger key={c} value={c}>
                  {c === "email" ? "E-mail" : "WhatsApp"}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            {channel === "email" ? "E-mail" : "WhatsApp"}
          </Badge>
        )}
      </header>

      <div className="space-y-3 p-5">
        {channel === "email" && (
          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject" className="text-xs">
              Assunto
            </Label>
            <Input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex.: Novo post para aprovar · {{post.title}}"
              className="h-9"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Mensagem</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                  <Braces className="mr-1.5 h-3.5 w-3.5" />
                  Variáveis
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  Variáveis disponíveis
                </p>
                <div className="flex flex-wrap gap-1">
                  {event.variables.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      title={v.label}
                      onClick={() => insertVariable(v.key)}
                      className="rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-[11px] hover:bg-accent"
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <Toolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <footer className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 bg-muted/20 p-5">
        <p className="min-w-0 truncate text-[11px] text-muted-foreground">
          {record
            ? `Personalizado · ${new Date(record.updated_at).toLocaleString("pt-BR")}`
            : "Usando template padrão do sistema"}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(true)}>
            <Eye className="mr-2 h-3.5 w-3.5" />
            Visualizar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTestOpen(true)}>
            <Send className="mr-2 h-3.5 w-3.5" />
            Enviar teste
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => resetMut.mutate()}
            disabled={!record || resetMut.isPending}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Restaurar padrão
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-2 h-3.5 w-3.5" />
            )}
            {saveMut.isPending ? "Salvando…" : "Salvar template"}
          </Button>
        </div>
      </footer>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Pré-visualização</DialogTitle>
            <DialogDescription>
              Renderizada com dados de exemplo para {event.name}.
            </DialogDescription>
          </DialogHeader>
          {channel === "email" ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <div className="border-b border-border/60 bg-muted/40 px-4 py-2 text-xs">
                <div className="text-muted-foreground">Assunto</div>
                <div className="font-medium">{renderTemplateString(subject, sampleCtx) || "—"}</div>
              </div>
              <div
                className="prose prose-sm dark:prose-invert max-h-[50vh] max-w-none overflow-auto p-4"
                dangerouslySetInnerHTML={{
                  __html: renderTemplateString(currentBody(), sampleCtx),
                }}
              />
            </div>
          ) : (
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-health-good/15 px-3 py-2 text-sm">
                <pre className="whitespace-pre-wrap font-sans">
                  {renderTemplateString(currentBody(), sampleCtx)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar teste</DialogTitle>
            <DialogDescription>
              Canal: {channel === "email" ? "E-mail" : "WhatsApp"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tpl-test-to">Destinatário</Label>
            <Input
              id="tpl-test-to"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={channel === "email" ? "voce@dominio.com" : "+55 11 90000-0000"}
            />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setTestOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
              {testMut.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-2 h-3.5 w-3.5" />
              )}
              Confirmar envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const Btn = ({
    onClick,
    active,
    children,
    title,
  }: {
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 border-b border-border/60 bg-muted/20 px-2 py-1">
      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Negrito"
      >
        <Bold className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Itálico"
      >
        <Italic className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Lista"
      >
        <List className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Lista numerada"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        onClick={() => {
          const url = window.prompt("URL do link");
          if (!url) return;
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
        active={editor.isActive("link")}
        title="Link"
      >
        <Link2 className="h-3.5 w-3.5" />
      </Btn>
    </div>
  );
}
