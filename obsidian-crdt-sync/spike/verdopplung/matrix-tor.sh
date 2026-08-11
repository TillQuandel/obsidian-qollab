#!/bin/sh
# WARUM: `docs/produktziel.md` schreibt die Duplikate „zu 100 %" der
# Materialisierung der per Sync gelieferten `.md` als EIGENE Op zu. Genau diesen
# Weg schliesst HEBEL B (`modus=tor`, `spike/schnitt/hebel.mjs:70`): er bindet
# `WriteProvenance.istEigen` zusaetzlich an den Doc-Stand, sodass ein geliefertes
# `.md` nicht mehr als „eigen" durchgeht, sondern geparkt wird. Traegt die alte
# Zuschreibung, muss die Verdopplung unter `tor` einbrechen.
#
#   sh matrix-tor.sh [zellen]
#
# ZELLBASIS GEKUERZT: Z0, Z1, Z3, Z6 (wie matrix-union.sh) — Referenz aus
# `ergebnis-patch-dreiwege.txt`: verdopp 845 / 1557 / 2401 / 1056.
cd "$(dirname "$0")/../schnitt" || exit 1
Z="${1:-0136}"
OUT="../verdopplung/ergebnis-tor.txt"
: > "$OUT"
export SPIKE_BUNDLE=./real-neu.cjs
export SPIKE_PATCH=dreiwege
export SPIKE_NOTES=10
export SPIKE_EDITS=1
NODE="node --max-old-space-size=8192"

echo "# HEBEL B (tor)   (je Zelle 200 Seeds x 10 Notizen, patch=dreiwege)" >> "$OUT"

lauf() {
  case "$Z" in *"$1"*) ;; *) return 0 ;; esac
  shift
  echo "  -> $*" >&2
  "$@" >> "$OUT" 2>&1
}

lauf 0 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 tor
lauf 1 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 5 42 1 200 tor
lauf 3 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 6 42 1 200 tor
lauf 6 env SPIKE_BASELINES=8 SPIKE_MDMODUS=ueberschreiben $NODE mehrfach.mjs 4 42 1 200 tor

echo "# fertig: tor" >> "$OUT"
