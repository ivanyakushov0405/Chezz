#!/usr/bin/env bash
# Бюджет бандла главной: ≤ 300 КБ gzip (ТЗ §5; ARCHITECTURE §12; TESTING §11). Запуск после сборки:
#   npm run build -w @chezz/web && bash scripts/check-bundle.sh
# Коды: 0 — в бюджете; 1 — сверх бюджета; 2 — нет сборки apps/web/dist.
set -u
export LC_ALL=C

cd "$(dirname "$0")/.." || exit 2

DIST="apps/web/dist"
LIMIT_BYTES=307200

if [ ! -d "$DIST" ]; then
  echo "check-bundle: ${DIST} not found — сначала сборка: npm run build -w @chezz/web" >&2
  exit 2
fi

# Главная: JS и CSS, подключённые из dist/index.html (script, link rel=stylesheet|modulepreload).
if [ ! -f "$DIST/index.html" ]; then
  echo "check-bundle: ${DIST}/index.html not found" >&2
  exit 2
fi
total=0
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  file="$DIST/${ref#/}"
  [ -f "$file" ] || continue
  size=$(gzip -9 -c "$file" | wc -c | tr -d ' ')
  total=$((total + size))
  echo "  $(printf '%8d' "$size") B gzip  ${file}"
done < <(
  {
    grep -oE '<script[^>]*src="[^"]+"' "$DIST/index.html" | grep -oE 'src="[^"]+"'
    grep -oE '<link[^>]*>' "$DIST/index.html" | grep -E 'rel="(stylesheet|modulepreload)"' | grep -oE 'href="[^"]+"'
  } | sed -E 's/^(src|href)="//; s/"$//' | sort -u
)

echo "check-bundle: total ${total} B gzip, limit ${LIMIT_BYTES} B"
if [ "$total" -gt "$LIMIT_BYTES" ]; then
  echo "check-bundle: FAILED — main page bundle exceeds 300 KB gzip (ТЗ §5)" >&2
  exit 1
fi
echo "check-bundle: ok"
