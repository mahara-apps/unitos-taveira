import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { describeError } from "@/lib/errors";
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  LayoutGrid,
  Play,
  Layers,
  CircleDot,
  Image as ImageIcon,
  Loader2,
  Send,
  Sparkles,
  UploadCloud,
  X,
  Hash,
  MessageCircle,
  Link2,
  MapPin,
  AlertTriangle,
  Heart,
  MessageSquare,
  Bookmark,
  Share,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { MediaLibraryDialog } from "@/components/calendar/schedule-wizard/media-library-dialog";
import { PublicationStatusPanel } from "@/components/calendar/schedule-wizard/publication-status";
import {
  MIN_SCHEDULE_LEAD_MESSAGE,
  MIN_SCHEDULE_LEAD_MINUTES,
  earliestScheduleDateInput,
  earliestScheduleTimeInput,
  isScheduleLeadValid,
} from "@/lib/schedule-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlacementOptions } from "@/lib/placement-options";
import { cn } from "@/lib/utils";
import { PlacementOptionsPopover } from "./placement-options-popover";
import {
  FORMATS_BY_CHANNEL,
  FORMAT_LABEL,
  tightestCaptionLimit,
  type PlacementFormat,
  type MediaKind,
  inferMediaKind,
  isFormatCompatibleWithMedia,
  formatIncompatibilityReason,
  suggestFormatsForMedia,
} from "@/lib/scheduling-formats";
import { SOCIAL_CHANNELS, type SocialChannel } from "@/lib/social-core/capabilities";
import { PostPreview } from "@/components/social/post-preview";
import {
  listClientSocialConnectionsFn,
  loadPostStateFn,
  saveScheduledPostFn,
  cancelPostScheduleFn,
  type WizardConnection,
} from "@/lib/scheduling-wizard.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  listBrandMediaFn,
  registerBrandMediaFn,
  type BrandMediaAsset,
} from "@/lib/brand-media.functions";
import { searchInstagramLocationsFn } from "@/lib/meta/locations.functions";
import {
  checkDestinationsReadinessFn,
  revalidateConnectionCapabilityFn,
  type DestinationReadiness,
} from "@/lib/publish-capability.functions";

import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function slugifyMediaName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

const FORMAT_ICON: Record<PlacementFormat, typeof LayoutGrid> = {
  feed: LayoutGrid,
  stories: CircleDot,
  reels: Play,
  carrossel: Layers,
};

export type WizardSeed = {
  postId?: string;
  title?: string;
  copy?: string;
  coverUrl?: string | null;
  targetConnectionIds?: string[];
};

type Pair = { channel: SocialChannel; format: PlacementFormat; connectionId: string };

/** Chave estável das opções por destino. */
const destKey = (p: { connectionId: string; format: PlacementFormat }) =>
  `${p.connectionId}::${p.format}`;

export function ScheduleWizard({
  open,
  onOpenChange,
  brandId,
  clientId,
  seed,
  defaultDate,
  onSaved,
  queueTotal,
  queueIndex,
  onQueueNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
  seed?: WizardSeed | null;
  defaultDate?: Date | null;
  onSaved?: () => void;
  /** Fila de rascunhos: total de itens navegáveis (opcional). */
  queueTotal?: number;
  /** Índice atual dentro da fila (0-based). */
  queueIndex?: number;
  /** Navega para outro item da fila (o pai troca o seed). */
  onQueueNavigate?: (index: number) => void;
}) {

  const qc = useQueryClient();
  const listConnections = useServerFn(listClientSocialConnectionsFn);
  const listMedia = useServerFn(listBrandMediaFn);
  const saveFn = useServerFn(saveScheduledPostFn);
  const registerMedia = useServerFn(registerBrandMediaFn);
  const loadPostState = useServerFn(loadPostStateFn);
  const cancelSchedule = useServerFn(cancelPostScheduleFn);

  const [title, setTitle] = useState("");
  const [copy, setCopy] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  // Opções avançadas por destino (connectionId::format).
  const [destOptions, setDestOptions] = useState<Record<string, PlacementOptions>>({});
  const [selectedMedia, setSelectedMedia] = useState<BrandMediaAsset[]>([]);
  const [scheduleDate, setScheduleDate] = useState<string>("");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [locationName, setLocationName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState<
    null | "draft" | "publish" | "schedule" | "save_draft"
  >(null);
  const [previewKey, setPreviewKey] = useState<string>("instagram::feed");
  const [locationId, setLocationId] = useState<string | null>(null);
  // ID da peça em edição. Começa no seed e passa a existir localmente depois do
  // primeiro save — impede que "Salvar rascunho" duas vezes crie duas peças.
  const [postId, setPostId] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  // Agendamento vigente da peça (quando ela é reaberta já agendada).
  const [scheduledAtIso, setScheduledAtIso] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // UI local do composer (não persiste nada).
  const [destPickerOpen, setDestPickerOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  // Navegação na fila de rascunhos: alterações não salvas pedem confirmação.
  const dirtyRef = useRef(false);
  const [pendingNav, setPendingNav] = useState<number | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);


  useEffect(() => {
    // Só reseta na transição fechado → aberto para garantir tela limpa
    // sempre que o wizard reabre (Novo, editar rascunho, etc).
    if (open && !wasOpenRef.current) {
      setTitle(seed?.title ?? "");
      setCopy(seed?.copy ?? "");
      setPairs([]);
      setDestOptions({});
      setSelectedMedia([]);
      setHashtags([]);
      setTagInput("");
      setFirstComment("");
      setLinkUrl("");
      setLocationName("");
      setLocationId(null);
      setDragActive(false);
      setUploading(false);
      setSubmitting(null);
      setPreviewKey("instagram::feed");
      setPostId(seed?.postId ?? null);
      setScheduledAtIso(null);
      setCancelOpen(false);
      setCancelling(false);
      setDestPickerOpen(false);
      setLibraryOpen(false);
      setShowExtras(false);
      if (uploadRef.current) uploadRef.current.value = "";
      const base = defaultDate ? new Date(defaultDate) : new Date(Date.now() + 60 * 60 * 1000);
      base.setSeconds(0, 0);
      setScheduleDate(fmtDate(base));
      setScheduleTime(fmtTime(base));
    }
    wasOpenRef.current = open;
  }, [open, seed, defaultDate]);

  // Marca "alterações não salvas" a cada edição do composer. Declarado ANTES do
  // efeito de reset abaixo para que hidratação/troca de peça limpe a flag.
  useEffect(() => {
    dirtyRef.current = true;
  }, [
    title,
    copy,
    pairs,
    selectedMedia,
    hashtags,
    firstComment,
    linkUrl,
    locationName,
    scheduleDate,
    scheduleTime,
  ]);

  useEffect(() => {
    if (!hydrating) dirtyRef.current = false;
  }, [hydrating, seed?.postId, open]);



  const connectionsQ = useQuery({
    enabled: open,
    queryKey: ["wizard-connections", brandId, clientId],
    queryFn: () => listConnections({ data: { brandId, clientId } }),
  });

  // Reabrir peça existente = restaurar o estado COMPLETO (mídia, destinos,
  // hashtags, link, local, agendamento). Sem isso o rascunho voltava vazio.
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedForRef.current = null;
      return;
    }
    const id = seed?.postId;
    if (!id || hydratedForRef.current === id) return;
    hydratedForRef.current = id;
    // Navegação na fila troca o seed com o wizard aberto: o postId em edição
    // precisa acompanhar, senão o save escreveria na peça anterior.
    setPostId(id);
    setScheduledAtIso(null);
    let cancelled = false;
    setHydrating(true);

    loadPostState({ data: { postId: id, brandId } })
      .then((st) => {
        if (cancelled) return;
        setTitle(st.title || seed?.title || "");
        setCopy(st.copy ?? "");
        setHashtags(st.hashtags ?? []);
        setFirstComment(st.firstComment ?? "");
        setLinkUrl(st.linkUrl ?? "");
        setLocationName(st.locationName ?? "");
        setLocationId(st.locationId ?? null);
        setPairs(
          (st.destinations ?? []).map((d) => ({
            channel: d.channel as SocialChannel,
            format: d.format as PlacementFormat,
            connectionId: d.connectionId,
          })),
        );
        setDestOptions(
          Object.fromEntries(
            (st.destinations ?? [])
              .filter((d) => d.options && Object.keys(d.options).length > 0)
              .map((d) => [
                `${d.connectionId}::${d.format}`,
                d.options as PlacementOptions,
              ]),
          ),
        );
        setSelectedMedia(
          (st.media ?? []).map((m) => ({
            id: m.id,
            brandId,
            clientId,
            storagePath: m.storagePath,
            name: m.name,
            mimeType: m.mimeType,
            sizeBytes: 0,
            kind: m.kind,
            width: null,
            height: null,
            tags: [],
            createdAt: new Date().toISOString(),
            publicUrl: m.publicUrl,
          })),
        );
        if (st.scheduledAt) {
          const d = new Date(st.scheduledAt);
          setScheduleDate(fmtDate(d));
          setScheduleTime(fmtTime(d));
        }
        // Peça agendada continua editável — só sinalizamos o estado para
        // liberar a ação "Cancelar agendamento".
        setScheduledAtIso(st.stage === "scheduled" ? (st.scheduledAt ?? null) : null);
      })
      .catch((e) => toast.error(describeError(e)))
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, seed?.postId, brandId, clientId, loadPostState, seed?.title]);

  // Destino restaurado cujo canal não está mais vinculado ao cliente é
  // removido do composer (o banco rejeita o save com esse destino).
  useEffect(() => {
    if (!open || hydrating) return;
    const conns = connectionsQ.data;
    if (!conns || conns.length === 0) return;
    const valid = new Set(conns.map((c) => c.connectionId));
    setPairs((prev) => {
      const kept = prev.filter((p) => valid.has(p.connectionId));
      if (kept.length === prev.length) return prev;
      toast.warning("Um destino foi removido: a conta não está mais vinculada a este cliente.");
      return kept;
    });
  }, [open, hydrating, connectionsQ.data]);

  // Pré-preenche destinos a partir das conexões escolhidas na tela de Conteúdo
  // (Kanban → target_connection_ids), quando o wizard abre com um seed.
  useEffect(() => {
    if (!open || hydrating) return;
    const ids = seed?.targetConnectionIds ?? [];
    if (ids.length === 0) return;
    const conns = connectionsQ.data ?? [];
    if (conns.length === 0) return;
    setPairs((prev) => {
      if (prev.length > 0) return prev;
      const next: Pair[] = [];
      for (const id of ids) {
        const c = conns.find((x) => x.connectionId === id);
        if (!c) continue;
        next.push({
          channel: c.channel as SocialChannel,
          format: "feed" satisfies PlacementFormat,
          connectionId: id,
        });
      }
      return next;
    });
  }, [open, hydrating, seed?.targetConnectionIds, connectionsQ.data]);

  const mediaQ = useQuery({
    enabled: open,
    queryKey: ["wizard-media", brandId, clientId],
    queryFn: () => listMedia({ data: { brandId, clientId, limit: 60 } }),
  });

  const connByChannel = useMemo(() => {
    const map = new Map<SocialChannel, WizardConnection>();
    (connectionsQ.data ?? []).forEach((c) => {
      if (!map.has(c.channel as SocialChannel)) {
        map.set(c.channel as SocialChannel, c);
      }
    });
    return map;
  }, [connectionsQ.data]);

  // ---- Prontidão de publicação por destino (blindagem Meta, fail closed) ----
  // "Ativo" não basta: só liberamos o agendamento quando a Meta autoriza a
  // publicação para AQUELA conta (granular scope) e o vínculo com o cliente
  // continua válido.
  const checkReadiness = useServerFn(checkDestinationsReadinessFn);
  const revalidateCapability = useServerFn(revalidateConnectionCapabilityFn);
  const selectedConnectionIds = useMemo(
    () => Array.from(new Set(pairs.map((p) => p.connectionId))).sort(),
    [pairs],
  );
  const readinessQ = useQuery({
    enabled: open && !hydrating && selectedConnectionIds.length > 0,
    queryKey: ["publish-readiness", brandId, clientId, selectedConnectionIds],
    queryFn: () =>
      checkReadiness({
        data: { brandId, clientId, connectionIds: selectedConnectionIds },
      }),
    staleTime: 60_000,
  });
  const readinessByConn = useMemo(() => {
    const map = new Map<string, DestinationReadiness>();
    (readinessQ.data ?? []).forEach((r) => map.set(r.connectionId, r));
    return map;
  }, [readinessQ.data]);
  const blockedDestinations = useMemo(
    () => pairs.filter((p) => readinessByConn.get(p.connectionId)?.publishReady === false),
    [pairs, readinessByConn],
  );

  const handleRevalidate = useCallback(
    async (connectionId: string) => {
      try {
        const r = await revalidateCapability({
          data: { brandId, clientId, connectionId },
        });
        await readinessQ.refetch();
        if (r.publishReady) toast.success("Destino pronto para publicar.");
        else toast.error(r.message);
      } catch (e) {
        toast.error(describeError(e));
      }
    },
    [brandId, clientId, revalidateCapability, readinessQ],
  );

  const mediaKind: MediaKind = useMemo(() => inferMediaKind(selectedMedia), [selectedMedia]);

  useEffect(() => {
    if (hydrating) return;
    setPairs((prev) => prev.filter((p) => isFormatCompatibleWithMedia(p.format, mediaKind)));
  }, [mediaKind, hydrating]);

  // Ensure preview channel is one we have selected — else fall back to first pair
  useEffect(() => {
    if (!pairs.length) return;
    if (!pairs.some((p) => `${p.channel}::${p.format}` === previewKey)) {
      setPreviewKey(`${pairs[0].channel}::${pairs[0].format}`);
    }
  }, [pairs, previewKey]);

  const previewPair = useMemo(() => {
    const found = pairs.find((p) => `${p.channel}::${p.format}` === previewKey);
    return found ?? pairs[0] ?? null;
  }, [pairs, previewKey]);

  const cyclePreview = useCallback(
    (dir: 1 | -1) => {
      if (pairs.length <= 1) return;
      const idx = Math.max(
        0,
        pairs.findIndex((p) => `${p.channel}::${p.format}` === previewKey),
      );
      const next = pairs[(idx + dir + pairs.length) % pairs.length];
      setPreviewKey(`${next.channel}::${next.format}`);
    },
    [pairs, previewKey],
  );

  const captionLimit = useMemo(() => tightestCaptionLimit(pairs.map((p) => p.channel)), [pairs]);

  const overLimit = copy.length > captionLimit;
  // Rascunho pode ser salvo sempre; agendar/publicar exige TODOS os destinos
  // com capacidade confirmada (fail closed).
  const canSubmit = pairs.length > 0 && !overLimit && !!title.trim();
  const canPublish = canSubmit && blockedDestinations.length === 0 && !readinessQ.isLoading;

  function togglePair(channel: SocialChannel, format: PlacementFormat) {
    const conn = connByChannel.get(channel);
    if (!conn) {
      toast.error("Conecte esta conta em Conexões primeiro.");
      return;
    }
    if (!isFormatCompatibleWithMedia(format, mediaKind)) {
      toast.error(
        formatIncompatibilityReason(format, mediaKind) ??
          "Formato incompatível com a mídia selecionada.",
      );
      return;
    }
    setPairs((prev) => {
      const exists = prev.find((p) => p.channel === channel && p.format === format);
      if (exists) return prev.filter((p) => !(p.channel === channel && p.format === format));
      return [...prev, { channel, format, connectionId: conn.connectionId }];
    });
  }

  function autoSuggestPairs() {
    const suggested: Pair[] = [];
    for (const [channel, conn] of connByChannel.entries()) {
      const [fmt] = suggestFormatsForMedia(channel, mediaKind);
      if (fmt) suggested.push({ channel, format: fmt, connectionId: conn.connectionId });
    }
    if (suggested.length) {
      setPairs(suggested);
      toast.success(`Sugestão aplicada em ${suggested.length} canal(is)`);
    } else {
      toast.error("Nenhuma sugestão disponível — conecte contas ou adicione mídia.");
    }
  }

  const handleUpload = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const arr = Array.from(files);
      if (!arr.length) return;
      setUploading(true);
      const uploaded: BrandMediaAsset[] = [];
      try {
        for (const file of arr) {
          const path = `${brandId}/${clientId}/${crypto.randomUUID()}-${slugifyMediaName(file.name)}`;
          const { error: upErr } = await supabase.storage
            .from("brand-media")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (upErr) throw new Error(upErr.message);
          const asset = await registerMedia({
            data: {
              brandId,
              clientId,
              storagePath: path,
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size,
              tags: [],
            },
          });
          uploaded.push(asset);
        }
        setSelectedMedia((prev) => {
          const merged = [...prev];
          for (const a of uploaded) if (!merged.find((x) => x.id === a.id)) merged.push(a);
          return merged;
        });
        qc.invalidateQueries({ queryKey: ["wizard-media", brandId, clientId] });
        qc.invalidateQueries({ queryKey: ["brand-media", brandId] });
        toast.success(`${uploaded.length} arquivo(s) enviados`);
      } catch (e) {
        toast.error(describeError(e));
      } finally {
        setUploading(false);
        if (uploadRef.current) uploadRef.current.value = "";
      }
    },
    [brandId, clientId, qc, registerMedia],
  );

  function commitTag() {
    const raw = tagInput.trim().replace(/^#/, "");
    if (!raw) return;
    if (hashtags.includes(raw)) {
      setTagInput("");
      return;
    }
    setHashtags([...hashtags, raw]);
    setTagInput("");
  }

  function toggleMedia(m: BrandMediaAsset) {
    setSelectedMedia((prev) =>
      prev.find((x) => x.id === m.id) ? prev.filter((x) => x.id !== m.id) : [...prev, m],
    );
  }

  async function persist(
    action: "draft" | "publish" | "schedule" | "save_draft",
    opts?: { keepOpen?: boolean },
  ): Promise<boolean> {
    if (action !== "save_draft" && !pairs.length) {
      toast.error("Selecione pelo menos um canal.");
      return false;
    }
    if (action === "schedule" && (!scheduleDate || !scheduleTime)) {
      toast.error("Defina data e horário para agendar.");
      return false;
    }
    // Regra dos 5 minutos: feedback antes de enviar (o servidor revalida).
    if (
      action === "schedule" &&
      !isScheduleLeadValid(new Date(`${scheduleDate}T${scheduleTime}`))
    ) {
      toast.error(MIN_SCHEDULE_LEAD_MESSAGE);
      return false;
    }
    if (submitting) return false;
    if (hydrating) {
      toast.error("Aguarde o carregamento da peça.");
      return false;
    }

    setSubmitting(action);
    try {
      const scheduledIso =
        action === "schedule" && scheduleDate && scheduleTime
          ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
          : null;
      const res: any = await saveFn({
        data: {
          // Sempre a peça em edição (local), nunca só o seed — evita duplicar
          // a peça quando o usuário salva o rascunho mais de uma vez.
          postId: postId ?? seed?.postId ?? null,
          brandId,
          clientId,
          title: title.trim() || "Publicação sem título",
          copy,
          mediaPaths: selectedMedia.map((m) => m.storagePath),
          mediaAssetIds: selectedMedia.map((m) => m.id),
          hashtags,
          firstComment: firstComment.trim() || null,
          linkUrl: linkUrl.trim() || null,
          locationName: locationName.trim() || null,
          locationId: locationId ?? null,
          destinations: pairs.map((p) => ({
            connectionId: p.connectionId,
            channel: p.channel,
            format: p.format,
            options: destOptions[destKey(p)] ?? null,
          })),
          scheduledAt: scheduledIso,
          action,
        },
      });
      if (res?.postId) setPostId(res.postId as string);
      if (action === "publish") {
        const okCount = res?.published ?? 0;
        const failed = (res?.results ?? []).filter((r: any) => !r.ok);
        if (okCount > 0) toast.success(`Publicado em ${okCount} canal(is)`);
        if (failed.length) {
          toast.error(
            `Falha em ${failed.length}: ${failed
              .map((f: any) => `${f.channel}/${f.format} — ${f.error}`)
              .join(" · ")}`,
          );
        }
      } else if (action === "save_draft") {
        toast.success("Rascunho salvo. Você pode retomar depois.");
      } else {
        toast.success(action === "draft" ? "Enviado para aprovação" : "Agendamento criado");
      }
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["pending-schedule"] });
      qc.invalidateQueries({ queryKey: ["wizard-drafts"] });
      onSaved?.();
      // "Salvar e próximo" mantém o modal aberto para seguir na fila.
      if (!opts?.keepOpen && (action !== "publish" || (res?.published ?? 0) > 0)) {
        onOpenChange(false);
      }
      dirtyRef.current = false;
      return true;
    } catch (e) {
      toast.error(describeError(e));
      return false;
    } finally {
      setSubmitting(null);
    }
  }

  // ---------------------------------------------------------------- fila
  const hasQueue = (queueTotal ?? 0) > 1 && typeof queueIndex === "number" && !!onQueueNavigate;
  const canPrev = hasQueue && (queueIndex ?? 0) > 0;
  const canNext = hasQueue && (queueIndex ?? 0) < (queueTotal ?? 0) - 1;

  function goQueue(dir: -1 | 1) {
    if (!onQueueNavigate || typeof queueIndex !== "number") return;
    const next = queueIndex + dir;
    if (next < 0 || next >= (queueTotal ?? 0)) return;
    if (dirtyRef.current) {
      setPendingNav(next);
      return;
    }
    onQueueNavigate(next);
  }

  async function saveAndNext() {
    const ok = await persist("save_draft", { keepOpen: true });
    if (!ok) return;
    if (canNext) onQueueNavigate?.((queueIndex ?? 0) + 1);
    else onOpenChange(false);
  }


  const primaryConn =
    (previewPair ? connByChannel.get(previewPair.channel) : null) ?? connectionsQ.data?.[0];
  const previewMedia = selectedMedia[0];

  // Política de link por rede/formato — feed do IG/Reels/TikTok não
  // renderiza URL clicável; Stories vira sticker; LinkedIn/FB/X funcionam.
  const linkPolicy = useMemo(() => {
    if (!pairs.length) return "none" as const;
    const policies = pairs.map((p) => classifyLinkPolicy(p.channel, p.format));
    const unique = Array.from(new Set(policies));
    if (unique.length === 1) return unique[0];
    return "mixed" as const;
  }, [pairs]);

  // Conexão Instagram para o autocomplete de local.
  const instagramConn = useMemo(
    () => (connectionsQ.data ?? []).find((c) => c.channel === "instagram") ?? null,
    [connectionsQ.data],
  );

  // Atalho ESC — fecha o sheet quando não estiver enviando.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onOpenChange(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!submitting) void persist("save_draft");
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        if (!submitting) goQueue(-1);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        if (!submitting) goQueue(1);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitting]);

  const busy = !!submitting || hydrating || cancelling;

  async function handleCancelSchedule() {
    if (!postId) return;
    setCancelling(true);
    try {
      await cancelSchedule({ data: { postId, brandId } });
      setScheduledAtIso(null);
      setCancelOpen(false);
      toast.success("Agendamento cancelado. A peça continua editável.");
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
      qc.invalidateQueries({ queryKey: ["board"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setCancelling(false);
    }
  }
  const selectedIds = selectedMedia.map((m) => m.id);
  const availableConnections = connectionsQ.data ?? [];

  return (
    <>
      <ExpandedModal
        open={open}
        onOpenChange={(v) => {
          if (!v && submitting) return;
          onOpenChange(v);
        }}
        size="composer"
        className="sm:h-[min(936px,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)]"
        title={postId ? "Editar publicação" : "Nova publicação"}
        description={
          pairs.length
            ? `${pairs.length} destino(s) · ${selectedMedia.length} mídia(s) · limite ${captionLimit} caracteres`
            : "Escolha os destinos, escreva a legenda e agende"
        }
        headerExtra={
          <>
            {hasQueue ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-1 py-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={!canPrev || busy}
                  title="Rascunho anterior (Alt + ←)"
                  onClick={() => goQueue(-1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
                  {(queueIndex ?? 0) + 1}/{queueTotal}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={!canNext || busy}
                  title="Próximo rascunho (Alt + →)"
                  onClick={() => goQueue(1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </span>
            ) : null}

            {hydrating ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Restaurando…
              </span>
            ) : null}
            {postId ? (
              <Badge variant="outline" className="text-[10px]">
                {scheduledAtIso ? "Agendada" : "Rascunho salvo"}
              </Badge>
            ) : null}
            {scheduledAtIso ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CalendarClock className="h-3 w-3" />
                  Agendado para{" "}
                  {new Date(scheduledAtIso).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={cancelling}
                  onClick={() => setCancelOpen(true)}
                >
                  {cancelling ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  Cancelar agendamento
                </Button>
              </>
            ) : null}
          </>
        }
        bodyClassName="grid min-h-0 grid-cols-1 overflow-hidden p-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,432px)]"
        footerClassName="justify-between"
        footer={
          <>
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              {submitting ? (
                <span className="flex items-center gap-2 text-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {submitting === "publish"
                    ? "Publicando…"
                    : submitting === "schedule"
                      ? "Agendando…"
                      : submitting === "save_draft"
                        ? "Salvando rascunho…"
                        : "Enviando para aprovação…"}
                </span>
              ) : pairs.length ? (
                <span className={cn("tabular-nums", overLimit && "text-destructive")}>
                  {copy.length}/{captionLimit} caracteres
                </span>
              ) : (
                <span>Selecione ao menos um destino.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!!submitting}
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || uploading}
                onClick={() => persist("save_draft")}
                title="Salvar como rascunho para continuar depois"
              >
                {submitting === "save_draft" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {postId ? "Salvar alterações" : "Salvar rascunho"}
              </Button>
              {hasQueue ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || uploading}
                  onClick={() => void saveAndNext()}
                  title="Salva esta peça e abre a próxima da fila"
                >
                  Salvar e próximo
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              ) : null}

              <Button
                variant="outline"
                size="sm"
                disabled={!canSubmit || busy || uploading}
                onClick={() => persist("draft")}
              >
                Enviar para aprovação
              </Button>
              <div className="inline-flex overflow-hidden rounded-md">
                <Button
                  size="sm"
                  className="rounded-r-none"
                  disabled={!canPublish || busy || uploading}
                  title={
                    canPublish
                      ? undefined
                      : ((blockedDestinations
                          .map((p) => readinessByConn.get(p.connectionId)?.message)
                          .filter(Boolean)[0] as string | undefined) ??
                        "Verificando autorização dos destinos…")
                  }
                  onClick={() => persist("schedule")}
                >
                  {submitting === "schedule" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Agendar
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="rounded-l-none border-l border-primary-foreground/20 px-2"
                      disabled={!canPublish || busy || uploading}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => persist("publish")}
                      disabled={busy || !canPublish}
                    >
                      <Send className="mr-2 h-3.5 w-3.5" /> Publicar agora
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => persist("schedule")}
                      disabled={busy || !canPublish}
                    >
                      <CalendarClock className="mr-2 h-3.5 w-3.5" /> Agendar para depois
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </>
        }
      >
        {/* ---------------- Coluna 1 — edição ---------------- */}
        <div className="min-h-0 space-y-5 overflow-y-auto border-b border-border/60 px-5 py-4 lg:border-b-0 lg:border-r">
          {/* Estado real de publicação por destino + republicação de falhas */}
          {postId ? <PublicationStatusPanel postId={postId} brandId={brandId} /> : null}

          {/* Destinos */}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Destinos</Label>
              <div className="flex items-center gap-1">
                {mediaKind !== "none" && availableConnections.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={autoSuggestPairs}
                  >
                    <Sparkles className="mr-1 h-3 w-3" /> Sugerir
                  </Button>
                ) : null}
                <Popover open={destPickerOpen} onOpenChange={setDestPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]">
                      Gerenciar destinos
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[340px] p-2">
                    {connectionsQ.isLoading ? (
                      <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando conexões…
                      </div>
                    ) : availableConnections.length === 0 ? (
                      <div className="p-3 text-center">
                        <p className="text-xs font-medium">
                          Nenhuma rede vinculada a este cliente.
                        </p>
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7 text-[11px]"
                        >
                          <Link to="/connections">Ir para Conexões</Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="max-h-[340px] space-y-2 overflow-y-auto">
                        {SOCIAL_CHANNELS.map((channel) => {
                          const conn = connByChannel.get(channel);
                          if (!conn) return null;
                          const formats = FORMATS_BY_CHANNEL[channel] ?? [];
                          return (
                            <div
                              key={channel}
                              className="rounded-lg border border-border/60 bg-card/40 p-2"
                            >
                              <div className="mb-1.5 flex min-w-0 items-center gap-2">
                                <Avatar className="h-6 w-6 shrink-0">
                                  <AvatarImage src={conn.avatarUrl ?? undefined} />
                                  <AvatarFallback className="text-[9px] uppercase">
                                    {channel.slice(0, 2)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] font-semibold capitalize">
                                    {channel}
                                  </div>
                                  <div className="truncate text-[10px] text-muted-foreground">
                                    {conn.handle ? `@${conn.handle}` : conn.accountLabel}
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {formats.map((f) => {
                                  const selected = pairs.some(
                                    (p) => p.channel === channel && p.format === f,
                                  );
                                  const compatible = isFormatCompatibleWithMedia(f, mediaKind);
                                  const reason = formatIncompatibilityReason(f, mediaKind);
                                  const Icon = FORMAT_ICON[f];
                                  return (
                                    <button
                                      key={f}
                                      type="button"
                                      disabled={!compatible}
                                      aria-pressed={selected}
                                      title={reason ?? `${FORMAT_LABEL[f]} disponível`}
                                      onClick={() => togglePair(channel, f)}
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-medium transition-colors",
                                        selected
                                          ? "border-foreground bg-foreground text-background"
                                          : "border-border/60 text-muted-foreground hover:text-foreground",
                                        !compatible && "cursor-not-allowed opacity-40",
                                      )}
                                    >
                                      <Icon className="h-3 w-3" />
                                      {FORMAT_LABEL[f]}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            {pairs.length === 0 ? (
              <button
                type="button"
                onClick={() => setDestPickerOpen(true)}
                className="w-full rounded-lg border border-dashed border-border/70 px-3 py-3 text-center text-[11px] text-muted-foreground transition-colors hover:bg-muted/40"
              >
                Nenhum destino selecionado — clique para escolher canais e formatos.
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {pairs.map((p) => {
                    const Icon = FORMAT_ICON[p.format];
                    const conn = connByChannel.get(p.channel);
                    const r = readinessByConn.get(p.connectionId);
                    const state = readinessQ.isLoading
                      ? "checking"
                      : !r
                        ? "checking"
                        : r.publishReady
                          ? "ready"
                          : r.action === "relink"
                            ? "disconnected"
                            : "auth";
                    return (
                      <span
                        key={`${p.channel}::${p.format}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10.5px]",
                          state === "ready"
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : state === "checking"
                              ? "border-border/60 bg-card"
                              : "border-destructive/50 bg-destructive/10",
                        )}
                      >
                        <Avatar className="h-4 w-4">
                          <AvatarImage src={conn?.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-[7px] uppercase">
                            {p.channel.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <Icon className="h-3 w-3 text-muted-foreground" />
                        <span className="capitalize">
                          {p.channel} · {FORMAT_LABEL[p.format]}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-4 border-none px-1 text-[9px] font-semibold",
                            state === "ready"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : state === "checking"
                                ? "bg-muted text-muted-foreground"
                                : "bg-destructive/15 text-destructive",
                          )}
                          title={r?.message ?? "Verificando autorização…"}
                        >
                          {state === "ready"
                            ? "Pronto"
                            : state === "checking"
                              ? "Verificando…"
                              : state === "disconnected"
                                ? "Desconectado"
                                : "Autorização necessária"}
                        </Badge>
                        <PlacementOptionsPopover
                          channel={p.channel}
                          format={p.format}
                          value={destOptions[destKey(p)] ?? {}}
                          onChange={(next) =>
                            setDestOptions((prev) => {
                              const draft = { ...prev };
                              if (!next || Object.keys(next).length === 0)
                                delete draft[destKey(p)];
                              else draft[destKey(p)] = next;
                              return draft;
                            })
                          }
                        />
                        <button
                          type="button"
                          onClick={() => togglePair(p.channel, p.format)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Remover destino"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
                {blockedDestinations.map((p) => {
                  const r = readinessByConn.get(p.connectionId);
                  if (!r) return null;
                  return (
                    <div
                      key={`blk-${p.connectionId}-${p.format}`}
                      className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[10.5px] text-destructive"
                    >
                      <span className="min-w-0">{r.message}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => handleRevalidate(p.connectionId)}
                        >
                          Revalidar
                        </Button>
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px]"
                        >
                          <Link to="/connections">Conexões</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <Separator />

          {/* Conteúdo */}
          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wiz-title" className="text-xs">
                Título interno
              </Label>
              <Input
                id="wiz-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Lançamento de coleção — reels"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="wiz-copy" className="text-xs">
                  Legenda
                </Label>
                <span
                  className={cn(
                    "text-[10.5px] tabular-nums",
                    overLimit ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {copy.length}/{captionLimit}
                </span>
              </div>
              <Textarea
                id="wiz-copy"
                value={copy}
                onChange={(e) => setCopy(e.target.value)}
                rows={7}
                placeholder="Escreva a legenda. Quebras de linha e parágrafos são preservados exatamente como digitados."
                className={cn(
                  "whitespace-pre-wrap font-normal",
                  overLimit && "border-destructive focus-visible:ring-destructive",
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs">
                <Hash className="h-3 w-3" /> Hashtags
              </Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 p-2">
                {hashtags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary"
                  >
                    #{t}
                    <button
                      type="button"
                      onClick={() => setHashtags(hashtags.filter((x) => x !== t))}
                      className="text-primary/70 hover:text-primary"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      commitTag();
                    } else if (e.key === "Backspace" && !tagInput && hashtags.length) {
                      setHashtags(hashtags.slice(0, -1));
                    }
                  }}
                  onBlur={commitTag}
                  placeholder={hashtags.length ? "" : "marketing, unitos, launch…"}
                  className="min-w-[120px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          </section>

          <Separator />

          {/* Mídia — experiência unificada */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Mídia da publicação{selectedMedia.length ? ` (${selectedMedia.length})` : ""}
              </Label>
              <div className="flex items-center gap-1">
                <input
                  ref={uploadRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={uploading}
                  onClick={() => uploadRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <UploadCloud className="mr-1 h-3 w-3" />
                  )}
                  Enviar arquivo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setLibraryOpen(true)}
                >
                  <ImageIcon className="mr-1 h-3 w-3" /> Biblioteca
                </Button>
              </div>
            </div>

            {mediaKind === "mixed" ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                <span>Remova imagens OU vídeos — apenas um tipo é permitido por publicação.</span>
              </div>
            ) : null}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                handleUpload(e.dataTransfer.files);
              }}
              className={cn(
                "rounded-xl border-2 border-dashed p-3 transition-colors",
                dragActive ? "border-primary bg-primary/5" : "border-border/70 bg-muted/20",
              )}
            >
              {selectedMedia.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedMedia.map((m, i) => (
                    <div
                      key={m.id}
                      className="relative h-20 w-20 overflow-hidden rounded-md border border-border/60 bg-muted"
                    >
                      {m.kind === "video" && m.publicUrl ? (
                        <video
                          src={m.publicUrl}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : m.publicUrl ? (
                        <img
                          src={m.publicUrl}
                          alt={m.name}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleMedia(m)}
                        className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-white hover:bg-destructive"
                        title="Remover"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-border/70 text-muted-foreground transition-colors hover:bg-muted/40"
                    title="Adicionar mídia"
                  >
                    <span className="text-lg leading-none">+</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 py-3 text-center">
                  <UploadCloud className="h-5 w-5 text-muted-foreground" />
                  <p className="text-[11px] font-medium">
                    Arraste arquivos aqui, envie do computador ou escolha na biblioteca
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Imagens ou vídeos até 100MB · a mídia fica salva na peça
                  </p>
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* Configurações adicionais */}
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setShowExtras((v) => !v)}
              className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>Configurações adicionais (link, local, primeiro comentário)</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showExtras && "rotate-180")}
              />
            </button>
            {showExtras ? (
              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-first-comment" className="flex items-center gap-1.5 text-xs">
                    <MessageCircle className="h-3 w-3" /> Primeiro comentário
                    <span className="text-[10px] font-normal text-muted-foreground">Instagram</span>
                  </Label>
                  <Textarea
                    id="wiz-first-comment"
                    rows={2}
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    placeholder="Ex.: pool de hashtags fixado."
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-link" className="flex items-center gap-1.5 text-xs">
                      <Link2 className="h-3 w-3" /> Link
                    </Label>
                    <Input
                      id="wiz-link"
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://…"
                    />
                    {linkUrl && linkPolicy !== "clickable" && linkPolicy !== "none" ? (
                      <p className="text-[10.5px] text-amber-600 dark:text-amber-400">
                        {linkPolicy === "not-clickable"
                          ? "Instagram/TikTok/Reels não tornam links clicáveis na legenda — use link na bio."
                          : linkPolicy === "sticker"
                            ? "Em Stories o link vira sticker — a URL não aparece no texto."
                            : "Seleções mistas: o link só é clicável em algumas redes."}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-location" className="flex items-center gap-1.5 text-xs">
                      <MapPin className="h-3 w-3" /> Local
                    </Label>
                    <LocationCombobox
                      brandId={brandId}
                      instagramConnectionId={instagramConn?.connectionId ?? null}
                      value={locationName}
                      onChange={(name, id) => {
                        setLocationName(name);
                        setLocationId(id);
                      }}
                    />
                    {locationName && !locationId ? (
                      <p className="text-[10.5px] text-muted-foreground">
                        Local salvo como texto — selecione uma sugestão para marcar no Instagram.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {/* ---------------- Coluna 2 — agenda + preview ---------------- */}
        <div className="min-h-0 space-y-4 overflow-y-auto bg-muted/20 px-4 py-4">
          <section className="space-y-2 rounded-xl border border-border/60 bg-background p-3">
            <Label className="text-xs">Data & horário</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <Input
                  type="date"
                  value={scheduleDate}
                  min={earliestScheduleDateInput()}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="pr-8 [&::-webkit-calendar-picker-indicator]:opacity-0"
                />
                <CalendarIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="relative">
                <Input
                  type="time"
                  value={scheduleTime}
                  min={earliestScheduleTimeInput(scheduleDate)}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="pr-8 [&::-webkit-calendar-picker-indicator]:opacity-0"
                />
                <ClockIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <p className="text-[10.5px] text-muted-foreground">
              Fuso: {tzLabel()} · mínimo de {MIN_SCHEDULE_LEAD_MINUTES} minutos a partir de agora ·
              use “Publicar agora” no menu ao lado de “Agendar”.
            </p>
            {scheduleDate &&
            scheduleTime &&
            !isScheduleLeadValid(new Date(`${scheduleDate}T${scheduleTime}`)) ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[10.5px] text-destructive">
                {MIN_SCHEDULE_LEAD_MESSAGE}
              </p>
            ) : null}
          </section>

          <section className="space-y-2 rounded-xl border border-border/60 bg-background p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Preview</Label>
              {pairs.length > 1 ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => cyclePreview(-1)}
                    aria-label="Destino anterior"
                    className="grid h-6 w-6 place-items-center rounded-full border border-border/60 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => cyclePreview(1)}
                    aria-label="Próximo destino"
                    className="grid h-6 w-6 place-items-center rounded-full border border-border/60 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
            {pairs.length ? (
              <div className="flex flex-wrap gap-1">
                {pairs.map((p) => {
                  const k = `${p.channel}::${p.format}`;
                  const active = previewKey === k;
                  const Icon = FORMAT_ICON[p.format];
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPreviewKey(k)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium capitalize transition-colors",
                        active
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {p.channel}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10.5px] text-muted-foreground">
                Selecione um destino para pré-visualizar.
              </p>
            )}
            <div className="flex justify-center pt-1">
              <PostPreview
                channel={previewPair?.channel ?? "instagram"}
                format={previewPair?.format ?? "feed"}
                handle={primaryConn?.handle ?? primaryConn?.accountLabel ?? "sua_marca"}
                avatarUrl={primaryConn?.avatarUrl ?? null}
                copy={copy}
                hashtags={hashtags}
                media={previewMedia}
                mediaItems={selectedMedia.map((m) => ({
                  publicUrl: m.publicUrl ?? null,
                  kind: m.kind,
                }))}
                mediaCount={selectedMedia.length}

                location={locationName}
              />
            </div>
          </section>
        </div>
      </ExpandedModal>

      {open ? (
        <MediaLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          brandId={brandId}
          clientId={clientId}
          selectedIds={selectedIds}
          onConfirm={(assets) => setSelectedMedia(assets)}
        />
      ) : null}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A publicação sai da fila e não será enviada às redes. A peça continua salva com
              legenda, mídias e destinos — você pode reagendar quando quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault();
                void handleCancelSchedule();
              }}
            >
              {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancelar agendamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fila de rascunhos: proteção contra perder edições ao navegar. */}
      <AlertDialog
        open={pendingNav !== null}
        onOpenChange={(v) => {
          if (!v) setPendingNav(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você tem alterações não salvas</AlertDialogTitle>
            <AlertDialogDescription>
              Salve esta peça antes de abrir a próxima, ou descarte as alterações e continue na
              fila.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!submitting}>Voltar</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={!!submitting}
              onClick={() => {
                const target = pendingNav;
                setPendingNav(null);
                dirtyRef.current = false;
                if (target !== null) onQueueNavigate?.(target);
              }}
            >
              Descartar e continuar
            </Button>
            <AlertDialogAction
              disabled={!!submitting}
              onClick={async (e) => {
                e.preventDefault();
                const target = pendingNav;
                const ok = await persist("save_draft", { keepOpen: true });
                if (!ok) return;
                setPendingNav(null);
                if (target !== null) onQueueNavigate?.(target);
              }}
            >
              {submitting === "save_draft" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Salvar e continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>

  );
}

// ============================================================
// Link policy — sinaliza se o link será clicável na rede escolhida.
// ============================================================

export type LinkPolicy = "none" | "clickable" | "sticker" | "not-clickable" | "mixed";

function classifyLinkPolicy(channel: SocialChannel, format: PlacementFormat): LinkPolicy {
  // Stories: Instagram/Facebook viram sticker de link.
  if (format === "stories") return "sticker";
  // Instagram feed/reels/carrossel: link não é clicável na legenda.
  if (channel === "instagram") return "not-clickable";
  // TikTok / YouTube Shorts (mapeados como reels): também não clicáveis na caption.
  if (channel === "tiktok" || channel === "youtube") return "not-clickable";
  // Facebook / LinkedIn / X / Threads: link clicável no feed.
  return "clickable";
}

// ============================================================
// LocationCombobox — busca locais do Graph com debounce.
// ============================================================

function LocationCombobox({
  brandId,
  instagramConnectionId,
  value,
  onChange,
}: {
  brandId: string;
  instagramConnectionId: string | null;
  value: string;
  onChange: (name: string, id: string | null) => void;
}) {
  const searchFn = useServerFn(searchInstagramLocationsFn);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    setQ(value);
  }, [value]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const searchQ = useQuery({
    enabled: open && !!instagramConnectionId && debounced.length >= 2,
    queryKey: ["ig-location", instagramConnectionId, debounced],
    queryFn: () =>
      searchFn({
        data: {
          brandId,
          connectionId: instagramConnectionId ?? "",
          query: debounced,
        },
      }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id="wiz-location"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onChange(e.target.value, null);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            instagramConnectionId ? "Digite para buscar no Instagram…" : "Ex.: São Paulo, SP"
          }
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {!instagramConnectionId ? (
          <div className="p-2 text-[11px] text-muted-foreground">
            Conecte um Instagram para buscar locais reais.
          </div>
        ) : debounced.length < 2 ? (
          <div className="p-2 text-[11px] text-muted-foreground">
            Digite ao menos 2 letras para buscar.
          </div>
        ) : searchQ.isFetching ? (
          <div className="flex items-center gap-2 p-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Buscando…
          </div>
        ) : searchQ.data && !searchQ.data.ok ? (
          <div className="max-w-full break-words p-2 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            {searchQ.data.error ?? "Falha na busca."}
          </div>
        ) : (searchQ.data?.results ?? []).length === 0 ? (
          <div className="p-2 text-[11px] text-muted-foreground">
            Nenhum local encontrado para “{debounced}”.
          </div>
        ) : (
          <ul className="max-h-64 overflow-auto">
            {(searchQ.data?.results ?? []).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-[11.5px] hover:bg-muted"
                  onClick={() => {
                    onChange(r.name, r.id);
                    setQ(r.name);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{r.name}</span>
                  {r.subtitle ? (
                    <span className="text-[10px] text-muted-foreground">{r.subtitle}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// Helpers
// ============================================================

function fmtDate(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tzLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}
