import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { QueryPersistence } from "@/lib/query-persistence";
import { resetIdentityState, isIdentityChange } from "@/lib/session-reset";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Unitos- Gerenciador de Conteudos Digitais para Agências de M" },
      {
        name: "description",
        content:
          "UNITOS: Gerenciador de conteúdos digitais para agências de marketing. Organize arquivos, campanhas, criativos e equipes em uma única plataforma.",
      },
      { name: "author", content: "Lovable" },
      {
        property: "og:title",
        content: "Unitos- Gerenciador de Conteudos Digitais para Agências de M",
      },
      {
        property: "og:description",
        content:
          "UNITOS: Gerenciador de conteúdos digitais para agências de marketing. Organize arquivos, campanhas, criativos e equipes em uma única plataforma.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      {
        name: "twitter:title",
        content: "Unitos- Gerenciador de Conteudos Digitais para Agências de M",
      },
      {
        name: "twitter:description",
        content:
          "UNITOS: Gerenciador de conteúdos digitais para agências de marketing. Organize arquivos, campanhas, criativos e equipes em uma única plataforma.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/4b55e1f7-dd3e-4d06-a643-cf026678069b",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/4b55e1f7-dd3e-4d06-a643-cf026678069b",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
    scripts: [
      {
        // Anti-flicker: aplica a classe de tema no <html> ANTES do primeiro
        // paint. Padrão "light" — dark só quando o usuário escolheu e salvou.
        children: `(function(){try{var t=window.localStorage.getItem("theme");var r=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";var d=document.documentElement;d.classList.remove("light","dark");d.classList.add(r);d.style.colorScheme=r;}catch(e){document.documentElement.classList.add("light");}})();`,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // `SIGNED_IN` também é emitido quando a sessão do MESMO usuário é
    // restaurada (boot) ou renovada. Tratar isso como troca de identidade
    // apagava workspace/cliente ativos e todo o cache no meio do boot.
    let previousUserId: string | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      previousUserId = previousUserId ?? (data.session?.user.id ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const nextUserId = session?.user.id ?? null;
      if (!isIdentityChange(event, previousUserId, nextUserId)) {
        previousUserId = nextUserId;
        return;
      }
      previousUserId = nextUserId;
      // Transição de identidade real: descarta cache/estado local do usuário
      // anterior antes de revalidar as rotas.
      resetIdentityState(queryClient);
      router.invalidate();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <QueryPersistence queryClient={queryClient} />
      <ThemeProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
