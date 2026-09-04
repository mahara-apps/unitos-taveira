import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
          patterns: [
            {
              group: [
                "@/lib/brain-*",
                "**/lib/brain-*",
                "@/hooks/use-brain-stream",
              ],
              message:
                "Brain-First: importe do namespace público `@/lib/brain/api` (nunca dos módulos legados `src/lib/brain-*.functions.ts` nem do hook antigo).",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Brain platform: apenas arquivos internos podem tocar tabelas `brain_*`.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "src/lib/brain/**",
      "supabase/**",
      "src/integrations/supabase/types.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.type='Literal'][arguments.0.value=/^brain_/]",
          message:
            "Brain-First: nenhum acesso direto a tabelas `brain_*` fora de `src/lib/brain/**`. Use `brain.*` de `@/lib/brain/api`.",
        },
      ],
    },
  },
  eslintPluginPrettier,
);
