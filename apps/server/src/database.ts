// Database — пересечение XTables всех модулей (ADR-0005 п.5). Новый модуль с таблицами —
// строка здесь (& UsersTables & …) и в app.ts.
import type { AnalyticsTables } from "./analytics/tables.ts";
import type { UsersTables } from "./users/tables.ts";

export type Database = AnalyticsTables & UsersTables;
