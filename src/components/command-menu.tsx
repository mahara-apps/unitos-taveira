import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useActiveContext } from "@/hooks/use-active-context";
import { searchWorkspace } from "@/lib/dashboard.functions";
import { listClients } from "@/lib/workspace.functions";
import { LayoutDashboard, KanbanSquare, BarChart3, Users, Settings } from "lucide-react";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { brandId, setClientId } = useActiveContext();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const search = useServerFn(searchWorkspace);
  const clientsFn = useServerFn(listClients);
  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => clientsFn({ data: { brandId: brandId! } }),
    enabled: !!brandId && open,
  });
  const searchQ = useQuery({
    queryKey: ["search", brandId, q],
    queryFn: () => search({ data: { brandId: brandId!, q } }),
    enabled: !!brandId && q.trim().length >= 2,
  });

  function go(to: string) {
    setOpen(false);
    navigate({ to });
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Buscar clientes, projetos, tarefas, posts…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        <CommandGroup heading="Navegar">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard /> Painel <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/content")}>
            <KanbanSquare /> Conteúdo <CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/customers")}>
            <Users /> Clientes
          </CommandItem>
          <CommandItem onSelect={() => go("/connections")}>
            <Settings /> Integrações e IA
          </CommandItem>
          <CommandItem onSelect={() => go("/analytics")}>
            <BarChart3 /> Análises
          </CommandItem>
        </CommandGroup>
        {clientsQ.data && clientsQ.data.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Trocar de cliente">
              <CommandItem
                onSelect={() => {
                  setClientId(null);
                  setOpen(false);
                }}
              >
                Toda a agência
              </CommandItem>
              {clientsQ.data.map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => {
                    setClientId(c.id);
                    setOpen(false);
                  }}
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ background: c.color ?? "#6366f1" }}
                  />{" "}
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {searchQ.data && q.trim().length >= 2 && (
          <>
            <CommandSeparator />
            {searchQ.data.clients.length > 0 && (
              <CommandGroup heading="Clientes">
                {searchQ.data.clients.map((c) => (
                  <CommandItem
                    key={c.id}
                    onSelect={() => {
                      setClientId(c.id);
                      go("/dashboard");
                    }}
                  >
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {searchQ.data.tasks.length > 0 && (
              <CommandGroup heading="Tarefas">
                {searchQ.data.tasks.map((t) => (
                  <CommandItem key={t.id} onSelect={() => go("/content")}>
                    {t.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {searchQ.data.posts.length > 0 && (
              <CommandGroup heading="Posts">
                {searchQ.data.posts.map((p) => (
                  <CommandItem key={p.id} onSelect={() => go("/content")}>
                    {p.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
