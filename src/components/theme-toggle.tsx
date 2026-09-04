import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Alternar tema"
      suppressHydrationWarning
      className="relative overflow-hidden rounded-md border border-border/60 bg-transparent shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:bg-accent"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun
        className={`h-4 w-4 transition-all duration-300 ${
          mounted && isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        }`}
      />
      <Moon
        className={`absolute h-4 w-4 transition-all duration-300 ${
          mounted && isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
        }`}
      />
      <span className="sr-only">Alternar tema</span>
    </Button>
  );
}
