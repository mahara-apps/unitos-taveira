import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getBrandBranding } from "@/lib/branding.functions";

/**
 * Branding OPCIONAL da instalação. Todos os campos de imagem são anuláveis:
 * quando nulos, a UI usa o SVG institucional local (`BrandLogo`), portanto
 * nenhuma instalação precisa configurar nada para ter logo funcional.
 */
export type BrandBranding = {
  logoLight: string | null;
  logoDark: string | null;
  icon: string | null;
  logoLogin: string | null;
  logoLightCustom: boolean;
  logoDarkCustom: boolean;
  iconCustom: boolean;
  logoLoginCustom: boolean;
  paths: {
    logo_light: string | null;
    logo_dark: string | null;
    icon: string | null;
    logo_login: string | null;
  };
};

async function sign(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("brand-assets")
    .createSignedUrl(path, 60 * 60 * 6);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export function useBrandBranding(brandId: string | null | undefined): BrandBranding {
  const fetcher = useServerFn(getBrandBranding);
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setHasSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  const paths = useQuery({
    queryKey: ["brand-branding", brandId],
    queryFn: () => fetcher({ data: { brandId: brandId! } }),
    enabled: !!brandId && hasSession,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [signed, setSigned] = useState<{
    light: string | null;
    dark: string | null;
    icon: string | null;
    login: string | null;
  }>({ light: null, dark: null, icon: null, login: null });

  useEffect(() => {
    let alive = true;
    const p = paths.data;
    if (!p) {
      setSigned({ light: null, dark: null, icon: null, login: null });
      return;
    }
    Promise.all([sign(p.logo_light), sign(p.logo_dark), sign(p.icon), sign(p.logo_login)]).then(
      ([light, dark, icon, login]) => {
        if (alive) setSigned({ light, dark, icon, login });
      },
    );
    return () => {
      alive = false;
    };
  }, [paths.data]);

  return {
    logoLight: signed.light,
    logoDark: signed.dark,
    icon: signed.icon,
    logoLogin: signed.login,
    logoLightCustom: !!signed.light,
    logoDarkCustom: !!signed.dark,
    iconCustom: !!signed.icon,
    logoLoginCustom: !!signed.login,
    paths: {
      logo_light: paths.data?.logo_light ?? null,
      logo_dark: paths.data?.logo_dark ?? null,
      icon: paths.data?.icon ?? null,
      logo_login: paths.data?.logo_login ?? null,
    },
  };
}
