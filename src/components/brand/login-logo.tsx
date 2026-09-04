import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { getLoginLogoFn } from "@/lib/login-branding.functions";
import { BrandLogo } from "@/components/brand/brand-logo";

/**
 * Logo da TELA DE LOGIN.
 *
 * Fonte opcional: Configurações → Agência → Identidade visual → "Logo da tela
 * de login". Sem upload (ou com URL inválida/expirada), cai automaticamente no
 * SVG institucional local do Unitos — nada a configurar por instalação.
 */
export function LoginLogo({ className }: { className?: string }) {
  const fetchLogo = useServerFn(getLoginLogoFn);
  const q = useQuery({
    queryKey: ["login-logo"],
    queryFn: () => fetchLogo(),
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: false,
  });

  return (
    <BrandLogo
      src={q.data?.url ?? null}
      variant="full"
      alt="Unitos"
      eager
      align="left"
      className={cn("w-full max-w-[360px] xl:max-w-[420px]", className)}
    />
  );
}
