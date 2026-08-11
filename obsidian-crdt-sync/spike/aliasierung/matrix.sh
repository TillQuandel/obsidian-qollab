#!/bin/sh
# Die Aliasierungs-Rate an `switchToGuid:1454` ueber die Zellen Z0/Z1/Z3/Z6.
#
# ZELLBASIS GEKUERZT und wortgleich uebernommen aus
# `spike/verdopplung/matrix-tor.sh` (das seinerseits auf `matrix-diff.sh`
# verweist): Z0, Z1, Z3, Z6, je 200 Seeds x 10 Notizen, edits=1, patch=dreiwege
# (Standard). Die vier ausgelassenen Zellen sind Z2 (N=5, DET=7), Z4/Z5 (200 bzw.
# 1000 Basiszeilen) und Z7 (ueberschreiben, DET=7) — Vergleichbarkeit mit den
# vorherigen Messungen geht hier vor Vollabdeckung.
#
# Referenz aus `ergebnis-patch-dreiwege.txt`: verdopp 845 / 1557 / 2401 / 1056.
# Referenz aus `ergebnis-aufrufstelle*.txt`, Zeile `switchToGuid`:
#   Z0 ruf=2183 neu=3178   Z1 ruf=3146 neu=4744
#   Z3 ruf=4294 neu=6459   Z6 ruf=2192 neu=3126
#
#   sh matrix.sh [zellen]     z. B. "01" oder "36"
#
# FALLSTRICK aus matrix-diff.sh uebernommen: hoechstens zwei dieser Stroeme
# parallel, sonst sprengt der Heap.
cd "$(dirname "$0")" || exit 1
Z="${1:-0136}"
OUT="ergebnis-aliasierung.txt"
[ -f "$OUT" ] || : > "$OUT"
export SPIKE_BUNDLE=../aliasierung/real-alias.cjs
export SPIKE_NOTES=10
export SPIKE_EDITS=1
export SPIKE_DET=42
NODE="node --max-old-space-size=8192"

lauf() {
  case "$Z" in *"$1"*) ;; *) return 0 ;; esac
  ZELLE="$1"
  shift
  echo "  -> Z$ZELLE $*" >&2
  SPIKE_ZELLE="$ZELLE" "$@" >> "$OUT" 2>&1
}

lauf 0 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE lauf.mjs 4 42 1 200
lauf 1 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE lauf.mjs 5 42 1 200
lauf 3 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE lauf.mjs 6 42 1 200
lauf 6 env SPIKE_BASELINES=8 SPIKE_MDMODUS=ueberschreiben $NODE lauf.mjs 4 42 1 200

echo "# fertig: $Z" >> "$OUT"
