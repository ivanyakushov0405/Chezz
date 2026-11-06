#!/usr/bin/env bash
# Бюджет бандла главной: ≤ 300 КБ gzip (ТЗ §5; ARCHITECTURE §12; TESTING §11). Запуск после сборки:
#   npm run build -w @chezz/web && bash scripts/check-bundle.sh
# Коды: 0 — в бюджете; 1 — сверх бюджета; 2 — нет сборки apps/web/dist.
# Каркас скелета (E01 T-2): считает gzip всех *.js и *.css в apps/web/dist/assets;
# какие чанки входят в главную, уточняет задача фронтенда (E01 T-5).
set -u
export LC_ALL=C

cd "$(dirname "$0")/.." || exit 2

DIST="apps/web/dist"
LIMIT_BYTES=$((300 * 1024))

if [ ! -d "$DIST" ]; then
  echo "check-bundle: ${DIST} not found — сначала сборка: npm run build -w @chezz/web" >&2
  exit 2
fi

total=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  size=$(gzip -9 -c "$file" | wc -c | tr -d ' ')
  total=$((total + size))
  echo "  $(printf '%8d' "$size") B gzip  ${file}"
done < <(find "$DIST/assets" -type f \( -name '*.js' -o -name '*.css' \) 2>/dev/null | sort)

echo "check-bundle: total ${total} B gzip, limit ${LIMIT_BYTES} B"
if [ "$total" -gt "$LIMIT_BYTES" ]; then
  echo "check-bundle: FAILED — main page bundle exceeds 300 KB gzip (ТЗ §5)" >&2
  exit 1
fi
echo "check-bundle: ok"
