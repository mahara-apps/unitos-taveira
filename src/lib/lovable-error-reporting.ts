type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const normalizedError = normalizeLovableError(error);
  window.__lovableEvents?.captureException?.(
    normalizedError,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );
}

export function normalizeLovableError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error === undefined) return new Error("Unknown client error: undefined was thrown");
  if (error === null) return new Error("Unknown client error: null was thrown");
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(`Unknown client error: ${JSON.stringify(error)}`);
  } catch {
    return new Error("Unknown client error: non-serializable value was thrown");
  }
}
