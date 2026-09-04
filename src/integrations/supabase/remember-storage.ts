import { brokeredPreviewStorage } from "./previewAuthStorage";

/**
 * Adaptador de storage que respeita a preferência "Lembrar-me".
 *
 * O cliente Supabase é um singleton criado no boot, mas os métodos
 * `getItem`/`setItem` são chamados em runtime — a cada chamada lemos a
 * flag `unitos:remember-me` (default `true`) e escolhemos o destino:
 *
 * - Habilitado (lembrar): `localStorage` — a sessão sobrevive a fechar o navegador.
 * - Desabilitado (não lembrar): `sessionStorage` — a sessão some ao fechar a aba.
 *
 * Em preview (iframe do editor) o broker de postMessage já cuida da sessão;
 * repassamos direto a ele, sem troca, pois preview é tooling de dev.
 */
const PREF_KEY = "unitos:remember-me";

function rememberEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Tipo mínimo aceito pelo supabase-js como `storage`: métodos síncronos ou
 * assíncronos (Promise) — ambos são suportados.
 */
type StorageLike = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export function createRememberStorage(): StorageLike {
  const base = brokeredPreviewStorage();

  // Em produção/preview-nao-framed o broker retorna o `localStorage` real.
  // Apenas nesse caso conseguimos trocar para sessionStorage; no broker de
  // preview (postMessage) mantemos o comportamento original.
  const isBrowserStorage =
    typeof Storage !== "undefined" && base === globalThis.localStorage;

  if (!isBrowserStorage) {
    return base as StorageLike;
  }

  return {
    getItem: (key: string) =>
      rememberEnabled()
        ? localStorage.getItem(key)
        : sessionStorage.getItem(key),
    setItem: (key: string, value: string) => {
      if (rememberEnabled()) localStorage.setItem(key, value);
      else sessionStorage.setItem(key, value);
    },
    removeItem: (key: string) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    },
  };
}
