// JSON реализованного протокола в stdout — вход scripts/check-api-doc.sh (API §16).
import { buildDump } from "../src/dump.ts";

process.stdout.write(`${JSON.stringify(buildDump())}\n`);
