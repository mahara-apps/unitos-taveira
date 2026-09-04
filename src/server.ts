import "./lib/error-capture";
// Registra todas as server functions no grafo do servidor (ver arquivo).
import "./lib/server-fn-registry.server";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { captureRuntimeEnv } from "./lib/runtime-env.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
function createErrorId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function logServerFailure(request: Request, errorId: string, error: unknown) {
  const url = new URL(request.url);
  console.error(`[server-error:${errorId}] ${request.method} ${url.pathname}`, error);
}

async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const errorId = createErrorId();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    logServerFailure(request, errorId, new Error(`Server returned HTTP ${response.status}`));
    const headers = new Headers(response.headers);
    headers.set("x-error-id", errorId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) {
    logServerFailure(request, errorId, new Error(`Server returned HTTP ${response.status}`));
    const headers = new Headers(response.headers);
    headers.set("x-error-id", errorId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  logServerFailure(
    request,
    errorId,
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(errorId), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8", "x-error-id": errorId },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Em runtimes serverless as variáveis chegam aqui, não em process.env.
    captureRuntimeEnv(env);
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      const errorId = createErrorId();
      logServerFailure(request, errorId, error);
      return new Response(renderErrorPage(errorId), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8", "x-error-id": errorId },
      });
    }
  },
};
