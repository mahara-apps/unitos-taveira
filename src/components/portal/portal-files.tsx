import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Eye,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Search,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalApi } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, formatBytes, formatDate } from "./portal-shared";

/**
 * FASE 7 — Arquivos do Portal.
 *
 * A lista vem do fluxo seguro já existente (`portal_files` + URL assinada), que
 * já devolve apenas os documentos liberados para o cliente. Aqui é só
 * apresentação: busca, filtro por tipo e download.
 */

type FileKind = "all" | "image" | "doc" | "sheet" | "other";

const KIND_LABEL: Record<Exclude<FileKind, "all">, string> = {
  image: "Imagens",
  doc: "Documentos",
  sheet: "Planilhas",
  other: "Outros",
};

function fileKind(mime: string | null, name: string): Exclude<FileKind, "all"> {
  const m = (mime ?? "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"].includes(ext))
    return "image";
  if (
    m.includes("pdf") ||
    m.includes("word") ||
    m.includes("text") ||
    ["pdf", "doc", "docx", "txt", "md"].includes(ext)
  )
    return "doc";
  if (
    m.includes("sheet") ||
    m.includes("csv") ||
    m.includes("excel") ||
    ["xls", "xlsx", "csv"].includes(ext)
  )
    return "sheet";
  return "other";
}

const KIND_ICON: Record<Exclude<FileKind, "all">, typeof FileText> = {
  image: ImageIcon,
  doc: FileText,
  sheet: Table2,
  other: FolderOpen,
};

/** Extensão exibida ao cliente como "tipo" simples. */
function fileExt(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() as string).toUpperCase().slice(0, 5) : "—";
}

export function PortalFiles() {
  const api = usePortalApi();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kind, setKind] = useState<FileKind>("all");
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const q = useQuery({
    queryKey: ["portal", "files", api.scopeKey, debouncedSearch],
    queryFn: () => api.files(debouncedSearch),
  });

  const rows = useMemo(
    () =>
      (q.data ?? []).map((f) => ({
        id: f.id as string,
        name: f.name as string,
        mime: (f.mime_type as string | null) ?? null,
        size: (f.size_bytes as number | null) ?? null,
        createdAt: f.created_at as string,
        url: (f.url as string | null) ?? null,
        kind: fileKind((f.mime_type as string | null) ?? null, f.name as string),
      })),
    [q.data],
  );

  const kinds = useMemo(() => {
    const set = new Set(rows.map((r) => r.kind));
    return (["image", "doc", "sheet", "other"] as const).filter((k) => set.has(k));
  }, [rows]);

  const visible = kind === "all" ? rows : rows.filter((r) => r.kind === kind);
  const showFilters = rows.length >= 6 && kinds.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome do arquivo"
            className="h-9 pl-9"
          />
        </div>
        {rows.length > 0 ? (
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {visible.length} {visible.length === 1 ? "arquivo" : "arquivos"}
          </div>
        ) : null}
      </div>

      {showFilters ? (
        <div className="flex flex-wrap gap-2">
          {(["all", ...kinds] as FileKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                kind === k
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "all" ? "Todos" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      ) : null}

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar seus arquivos agora."
          message={(q.error as Error)?.message}
          onRetry={() => q.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={search || kind !== "all" ? "Nenhum arquivo encontrado" : "Nenhum arquivo por aqui"}
          description={
            search || kind !== "all"
              ? "Tente outro termo ou remova o filtro."
              : "Os arquivos aparecem aqui assim que a equipe liberar documentos para você."
          }
        />
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
          {visible.map((f) => {
            const Icon = KIND_ICON[f.kind];
            return (
              <div
                key={f.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{fileExt(f.name)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatBytes(f.size)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(f.createdAt)}</span>
                    </div>
                  </div>
                </div>
                {f.url ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <a href={f.url} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost" className="gap-1.5">
                        <Eye className="h-3.5 w-3.5" /> Ver
                      </Button>
                    </a>
                    <a href={f.url} download={f.name}>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Download className="h-3.5 w-3.5" /> Baixar
                      </Button>
                    </a>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
