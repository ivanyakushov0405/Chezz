// Перезапись snapshot/protocol.json. Изменение снимка — в diff PR; несовместимое — PROTOCOL_VERSION + 1 (API §7, §16).
import { writeFileSync } from "node:fs";
import { buildSnapshot } from "../src/snapshot.ts";

const file = new URL("../src/snapshot/protocol.json", import.meta.url);
writeFileSync(file, `${JSON.stringify(buildSnapshot(), null, 2)}\n`);
