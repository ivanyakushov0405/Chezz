// Тип таблицы users (ADR-0005 п.5).
import type { UserSettings } from "@chezz/protocol";
import type { ColumnType, Generated } from "kysely";

export interface UsersTable {
  id: Generated<string>;
  google_sub: string | null;
  email: string | null;
  google_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  country: string | null;
  locale: "ru" | "en";
  settings: ColumnType<UserSettings, string, string>;
  terms_accepted_at: Date | null;
  nickname_changed_at: Date | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface UsersTables {
  users: UsersTable;
}
