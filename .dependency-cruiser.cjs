// Границы модулей и слоёв (ARCHITECTURE §7.1, §7.2, §7.4; ADR-0005 п.1, п.4).
// Правка таблицы 7.1 → правка MODULE_DEPS здесь в той же задаче (TESTING §11).
// app.ts, main.ts, database.ts лежат в apps/server/src/ вне папок модулей — правила модулей к ним не применяются.

/** Таблица 7.1: модуль → от кого может зависеть (кроме platform и analytics, разрешённых всем, см. ниже). */
const MODULE_DEPS = {
  platform: [],
  analytics: [],
  users: [],
  feedback: [],
  auth: ["users", "feedback", "games", "challenges", "matchmaking"],
  rating: ["users"],
  games: ["rating", "users"],
  challenges: ["games", "rating", "users"],
  matchmaking: ["games", "rating", "users"],
  profile: ["users", "games", "rating"],
  seo: ["profile", "rating", "games", "users"],
  realtime: ["auth", "games", "challenges", "matchmaking"],
};
const MODULES = Object.keys(MODULE_DEPS);
// От platform и analytics может зависеть любой модуль (§7.1); сам platform — ни от кого, analytics — только от platform.
const ALWAYS_ALLOWED = { platform: [], analytics: ["platform"] };

const SRC = "^apps/server/src/";

const moduleTableRules = MODULES.map((m) => {
  const allowed = new Set([m, ...MODULE_DEPS[m], ...(ALWAYS_ALLOWED[m] ?? ["platform", "analytics"])]);
  const forbidden = MODULES.filter((x) => !allowed.has(x));
  return forbidden.length === 0
    ? null
    : {
        name: `module-deps-${m}`,
        comment: `ARCHITECTURE §7.1: модуль ${m} может зависеть только от ${[...allowed].filter((x) => x !== m).join(", ") || "—"}`,
        severity: "error",
        from: { path: `${SRC}${m}/` },
        to: { path: `${SRC}(${forbidden.join("|")})/` },
      };
}).filter(Boolean);

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...moduleTableRules,
    {
      name: "foreign-module-internals",
      comment:
        "ADR-0005 п.4: из чужого модуля — только service.ts и events.ts (не api.ts, repo.ts, tables.ts, domain/**); " +
        "platform — набор инструментов для всех модулей (db, time, http, ws, errors, config; ADR-0005 п.5, 7, 8)",
      severity: "error",
      from: { path: `${SRC}([^/]+)/` },
      to: {
        path: `${SRC}[^/]+/`,
        pathNot: [`${SRC}$1/`, `${SRC}platform/`, `${SRC}[^/]+/(service|events)\\.ts$`],
      },
    },
    {
      name: "api-not-to-repo",
      comment: "ARCHITECTURE §7.2: api не импортирует repo",
      severity: "error",
      from: { path: `${SRC}[^/]+/api(\\.ts$|/)` },
      to: { path: `${SRC}[^/]+/repo(\\.ts$|/)` },
    },
    {
      name: "domain-no-io",
      comment: "ARCHITECTURE §7.2: domain/ не импортирует kysely, pg, fastify, ws",
      severity: "error",
      from: { path: `${SRC}[^/]+/domain/` },
      to: {
        path: "(^|/)node_modules/(kysely|pg|pg-[^/]+|fastify|@fastify/[^/]+|ws)/|^(kysely|pg|fastify|ws)$",
      },
    },
    {
      name: "web-not-to-server",
      comment: "ARCHITECTURE §7.4: apps/web не импортирует apps/server",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^apps/server/" },
    },
    {
      name: "no-circular",
      comment: "ARCHITECTURE §7.1: граф без циклов",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment: "импорт не разрешается — опечатка или нет зависимости",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(apps|packages)/[^/]+/(dist|coverage)/|^(test-results|playwright-report)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
