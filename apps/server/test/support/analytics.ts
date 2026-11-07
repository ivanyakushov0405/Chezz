// Чтение analytics_events базы воркера для тестов (design.md E03, «Тестовая инфраструктура»).
import pg from "pg";
import { workerDatabaseUrl } from "./db.ts";

export interface AnalyticsEventRow {
  id: string;
  name: string;
  user_id: string | null;
  game_id: string | null;
  props: Record<string, unknown>;
  created_at: Date;
}

export async function listAnalyticsEvents(): Promise<AnalyticsEventRow[]> {
  const client = new pg.Client({ connectionString: workerDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<AnalyticsEventRow>(
      "SELECT id, name, user_id, game_id, props, created_at FROM analytics_events ORDER BY created_at, id",
    );
    return rows;
  } finally {
    await client.end();
  }
}
