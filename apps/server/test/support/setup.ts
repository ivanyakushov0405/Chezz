// setupFiles проектов int и contract: перед каждым тестовым файлом — база воркера есть и пуста (TESTING §7.1).
import { ensureWorkerDatabase, truncateWorkerDatabase } from "./db.ts";

await ensureWorkerDatabase();
await truncateWorkerDatabase();
