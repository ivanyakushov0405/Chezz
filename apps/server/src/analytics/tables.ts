// Тип таблицы analytics_events (ADR-0005 п.5).
import type { ColumnType, Generated } from "kysely";

export interface AnalyticsEventsTable {
  id: Generated<string>;
  name: string;
  user_id: string | null;
  game_id: string | null;
  props: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: Date;
}

export interface AnalyticsTables {
  analytics_events: AnalyticsEventsTable;
}
