#!/usr/bin/env bash
# Каталог документа API = код протокола (API §16, ADR-0009 п.4).
# Коды 5.2, операции 12 (с методом и путём), type 9.1 + 13 (клиент) и 9.3 + 13 (сервер) сравниваются с
# `npm run -w packages/protocol dump`: код = реализованное ⊔ PENDING_CATALOG, каждое имя ровно в одном месте.
# Расхождение называется поимённо. Код 0 — чисто; 1 — расхождения. JSON разбирает node, без jq.
# Переменные для самопроверки: API_DOC — другой файл документа, PROTOCOL_DUMP — готовый JSON вместо dump.
set -u
export LC_ALL=C

cd "$(dirname "$0")/.." || exit 2

DOC="${API_DOC:-docs/API_CONVENTIONS.md}"
[ -f "$DOC" ] || { echo "check-api-doc: нет файла $DOC" >&2; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ -n "${PROTOCOL_DUMP:-}" ]; then
  cp "$PROTOCOL_DUMP" "$tmp/dump.json"
else
  npm run -s -w packages/protocol dump >"$tmp/dump.json" || { echo "check-api-doc: dump не выполнился" >&2; exit 2; }
fi

# section <начало-ERE> <конец-ERE> → строки от заголовка начала до следующего заголовка конца (без CR)
section() {
  tr -d '\r' <"$DOC" | awk -v start="$1" -v stop="$2" '
    inside && $0 ~ stop { exit }
    !inside && $0 ~ start { inside = 1; next }
    inside { print }
  '
}

# tokens: из первой ячейки строк таблицы — все `имена` (без `*`, без заголовков столбцов)
first_cell_tokens() {
  awk -F'|' '/^\|/ { print $2 }' | grep -oE '`[A-Za-z0-9_.*]+`' | tr -d '`' | grep -vE '^(code|type)$|\*' || true
}

# 5.2
section '^### 5.2. ' '^##+ ' | first_cell_tokens | sort -u >"$tmp/doc_codes"

# 12: `операция` | `МЕТОД /путь`
section '^## 12. ' '^## ' | tr -d '\r' |
  sed -nE 's/^\| `([A-Za-z0-9_]+)` \| `([A-Z]+) ([^` ]+)`.*/\1 \2 \3/p' | sort -u >"$tmp/doc_rest"

# 13: клиент и сервер, плюс 9.1 и 9.3
section '^## 13. ' '^## ' | awk '/^Сервер → клиент/ { exit } { print }' | first_cell_tokens >"$tmp/c13"
section '^## 13. ' '^## ' | awk '/^Сервер → клиент/ { on = 1; next } on { print }' | first_cell_tokens >"$tmp/s13"
section '^### 9.1. ' '^##+ ' | first_cell_tokens >"$tmp/c91"
section '^### 9.3. ' '^##+ ' | first_cell_tokens >"$tmp/s93"
sort -u "$tmp/c13" "$tmp/c91" >"$tmp/doc_ws_client"
sort -u "$tmp/s13" "$tmp/s93" >"$tmp/doc_ws_server"

for f in doc_codes doc_rest doc_ws_client doc_ws_server; do
  [ -s "$tmp/$f" ] || { echo "check-api-doc: из $DOC ничего не выписано ($f) — формат документа изменился?" >&2; exit 2; }
done

node - "$tmp" <<'JS'
const fs = require("node:fs");
const dir = process.argv[2];
const lines = (f) => fs.readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean);
const dump = JSON.parse(fs.readFileSync(`${dir}/dump.json`, "utf8"));
const errors = [];

// коды: документ = ErrorCode
{
  const doc = new Set(lines("doc_codes"));
  const code = new Set(dump.error_codes);
  for (const c of doc) if (!code.has(c)) errors.push(`код ошибки «${c}» есть в документе (5.2), нет в ErrorCode`);
  for (const c of code) if (!doc.has(c)) errors.push(`код ошибки «${c}» есть в ErrorCode, нет в документе (5.2)`);
}

// имена: документ = реализованное ⊔ pending, каждое ровно в одном месте
function compare(kind, docNames, implemented, pending) {
  const doc = new Set(docNames);
  const impl = new Set(implemented);
  const pend = new Set(pending);
  for (const n of doc) {
    if (!impl.has(n) && !pend.has(n)) errors.push(`${kind} «${n}» есть в документе, нет в коде (ни реализовано, ни в PENDING_CATALOG)`);
  }
  for (const n of impl) {
    if (!doc.has(n)) errors.push(`${kind} «${n}» реализовано в коде, нет в документе`);
    if (pend.has(n)) errors.push(`${kind} «${n}» одновременно реализовано и в PENDING_CATALOG`);
  }
  for (const n of pend) if (!doc.has(n)) errors.push(`${kind} «${n}» есть в PENDING_CATALOG, нет в документе`);
}

const docRest = lines("doc_rest").map((l) => {
  const [operation, method, path] = l.split(" ");
  return { operation, method, path };
});
compare("операция", docRest.map((r) => r.operation), dump.rest.map((r) => r.operation), dump.pending.rest);
for (const r of dump.rest) {
  const d = docRest.find((x) => x.operation === r.operation);
  if (d && (d.method !== r.method || d.path !== r.path)) {
    errors.push(`операция «${r.operation}»: в документе ${d.method} ${d.path}, в коде ${r.method} ${r.path}`);
  }
}
compare("type клиент → сервер", lines("doc_ws_client"), dump.ws_client, dump.pending.ws_client);
compare("type сервер → клиент", lines("doc_ws_server"), dump.ws_server, dump.pending.ws_server);

if (errors.length > 0) {
  for (const e of errors) console.error(`check-api-doc: ${e}`);
  console.error("check-api-doc: FAILED (API §16, ADR-0009)");
  process.exit(1);
}
console.log("check-api-doc: ok");
JS
