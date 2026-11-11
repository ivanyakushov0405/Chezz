// Тип таблицы sessions (ADR-0005 п.5).
import type { Generated } from "kysely";

export interface SessionsTable {
  id: Generated<string>;
  token_hash: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
}

export interface AuthTables {
  sessions: SessionsTable;
}
