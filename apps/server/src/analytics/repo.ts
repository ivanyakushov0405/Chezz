// SQL модуля analytics (ARCHITECTURE §7.4): единственное место, где пишется analytics_events.
import { forTables, type Db } from "../platform/db.ts";
import type { AnalyticsTables } from "./tables.ts";

export interface AnalyticsEventRecord {
  name: string;
  user_id: string | null;
  game_id: string | null;
  props: Record<string, unknown>;
  created_at: Date;
}

export async function insertEvent(db: Db, row: AnalyticsEventRecord): Promise<void> {
  await forTables<AnalyticsTables>(db)
    .insertInto("analytics_events")
    .values({ ...row, props: JSON.stringify(row.props) })
    .execute();
}
