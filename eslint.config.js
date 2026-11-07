// ESLint (flat config). Правила TESTING §1, §11; SECURITY §1, §10.
// Блоки корня правят backend (скелет), contracts, frontend — каждый свой (профиль, «Метки задач»).
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";
import react from "eslint-plugin-react";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const TS = ["**/*.{ts,tsx,mts,cts}"];
const VITEST_FILES = ["**/*.test.{ts,tsx}", "apps/server/test/**/*.ts"];
const E2E_FILES = ["tests/e2e/**/*.{ts,tsx}"];
// Единственное место, где разрешён it.skipIf — векторы вида C (TESTING §7.5).
const GLICKO_VECTORS = "apps/server/test/acceptance/glicko2-vectors.test.ts";

const noInnerHtmlSyntax = [
  {
    selector: "MemberExpression[computed=true][property.value=/^(innerHTML|outerHTML)$/]",
    message: "innerHTML запрещён (SECURITY §1, §10).",
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: "insertAdjacentHTML запрещён (SECURITY §1, §10).",
  },
];

const noInnerHtml = [
  { property: "innerHTML", message: "innerHTML запрещён (SECURITY §1, §10): только экранированный вывод." },
  { property: "outerHTML", message: "outerHTML запрещён (SECURITY §1, §10): только экранированный вывод." },
];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "test-results/**",
      "playwright-report/**",
      "tests/e2e/screens/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: c.files ?? TS })),
  {
    files: ["**/*.{js,mjs,ts,tsx,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly" },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", require: "readonly", __dirname: "readonly" } },
  },
  {
    files: TS,
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-undef": "off",
    },
  },
  // Запрет innerHTML / dangerouslySetInnerHTML — во всём коде (SECURITY §1, §10; TESTING §11).
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts,jsx}"],
    plugins: { react },
    settings: { react: { version: "19" } },
    rules: {
      "react/no-danger": "error",
      "no-restricted-properties": ["error", ...noInnerHtml],
      "no-restricted-syntax": ["error", ...noInnerHtmlSyntax],
    },
  },
  // Vitest: .only, .skip, .todo — запрещены (TESTING §1, §11).
  {
    files: VITEST_FILES,
    plugins: { vitest },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/warn-todo": "error",
      "no-restricted-syntax": [
        "error",
        ...noInnerHtmlSyntax,
        {
          selector: "CallExpression[callee.object.name=/^(it|test|describe|suite|bench)$/][callee.property.name=/^(only|skip|todo|skipIf|runIf)$/]",
          message: ".only/.skip/.todo/.skipIf запрещены (TESTING §1); it.skipIf — только векторы вида C (TESTING §7.5).",
        },
        {
          selector: "MemberExpression[object.name=/^(it|test|describe|suite)$/][property.name=/^(only|skip|todo)$/]",
          message: ".only/.skip/.todo запрещены (TESTING §1).",
        },
      ],
    },
  },
  {
    files: [GLICKO_VECTORS],
    rules: {
      "vitest/no-disabled-tests": "off",
      "no-restricted-syntax": [
        "error",
        ...noInnerHtmlSyntax,
        {
          selector: "CallExpression[callee.object.name=/^(it|test|describe|suite)$/][callee.property.name=/^(only|skip|todo|runIf)$/]",
          message: "здесь разрешён только it.skipIf для вида C (TESTING §7.5).",
        },
      ],
    },
  },
  // Playwright: test.only, test.skip, test.fixme — запрещены (TESTING §1, §11).
  {
    files: E2E_FILES,
    plugins: { playwright },
    rules: {
      "playwright/no-focused-test": "error",
      "playwright/no-skipped-test": "error",
      "no-restricted-syntax": [
        "error",
        ...noInnerHtmlSyntax,
        {
          selector: "CallExpression[callee.object.name=/^(test|describe)$/][callee.property.name=/^(only|skip|fixme)$/]",
          message: "test.only/.skip/.fixme запрещены (TESTING §1).",
        },
        {
          selector: "CallExpression[callee.object.object.name='test'][callee.object.property.name='describe'][callee.property.name=/^(only|skip|fixme)$/]",
          message: "test.describe.only/.skip/.fixme запрещены (TESTING §1).",
        },
      ],
    },
  },
);
