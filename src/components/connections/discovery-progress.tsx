import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * Estados de carregamento da descoberta Meta. A tela nunca aparece vazia:
 * cada etapa real do fluxo (OAuth → Páginas → Instagram → autorização) é
 * anunciada enquanto a varredura acontece.
 */
const PHASES = [
  "Conectando à Meta...",
  "Buscando páginas...",
  "Verificando contas Instagram...",
  "Autorização verificada",
] as const;

export function DiscoveryProgress({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    setPhase(0);
    const timers = [
      window.setTimeout(() => setPhase(1), 1200),
      window.setTimeout(() => setPhase(2), 4000),
      window.setTimeout(() => setPhase(3), 9000),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active]);

  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <ul className="w-full max-w-xs space-y-2">
        {PHASES.map((label, i) => {
          const done = i < phase;
          const current = i === phase;
          return (
            <li
              key={label}
              className={`flex items-center gap-2 text-xs transition-colors ${
                current
                  ? "font-medium text-foreground"
                  : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/40"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : current ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-border" />
              )}
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
