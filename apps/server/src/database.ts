// Database — пересечение XTables всех модулей (ADR-0005 п.5). Новый модуль с таблицами —
// строка здесь (& UsersTables & …) и в app.ts. В E01 таблиц нет.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}
