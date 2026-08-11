#!/bin/sh
# WARUM: `unionMerge` laesst sich nicht per Umschalter variieren — es gibt keinen.
# Deshalb zwei Arme auf dem ZAEHLBAU `real-zaehl.cjs` (gleicher Produktivcode,
# nur `./text-merge` auf die Zaehlhuelle umgebogen, siehe `bauen.mjs`):
#
#   bestand  zaehlt nur mit; die Verdopplung muss auf die Baseline fallen
#            (Z0 845, Z1 1557, Z3 2401, Z6 1056 aus ergebnis-patch-dreiwege.txt)
#            — das ist zugleich die Kalibrierung, dass die Huelle nichts aendert.
#   dedup    dieselbe Vereinigung ohne die Vorkommen, die sie SELBST erzeugt.
#            Die Differenz zu `bestand` ist der Anteil von `unionMerge`.
#
#   sh matrix-union.sh <arm> [zellen]     arm: bestand | dedup
#
# ZELLBASIS GEKUERZT, ausdruecklich: nur Z0, Z1, Z3, Z6 statt aller acht — die
# vier decken beide Konfliktmodi (`kopie`/`ueberschreiben`) und drei Geraetezahlen
# ab, kosten aber statt ~11 nur ~4,5 Minuten je Arm. Z4/Z5 (grosse Notizen)
# fehlen, Z2/Z7 sind nur die zweite Seed-Familie ihrer Nachbarn.
cd "$(dirname "$0")/../schnitt" || exit 1
A="${1:-bestand}"
Z="${2:-0136}"
OUT="../verdopplung/ergebnis-union-$A.txt"
: > "$OUT"
export SPIKE_BUNDLE=../verdopplung/real-zaehl.cjs
export SPIKE_PATCH=dreiwege
export SPIKE_NOTES=10
export SPIKE_EDITS=1
export QZAEHL_PRINT=1
export QZAEHL_UNION="$A"
NODE="node --max-old-space-size=8192"

echo "# union-Arm: $A   (je Zelle 200 Seeds x 10 Notizen, patch=dreiwege)" >> "$OUT"

lauf() {
  case "$Z" in *"$1"*) ;; *) return 0 ;; esac
  shift
  echo "  -> $*" >&2
  "$@" >> "$OUT" 2>&1
}

lauf 0 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
lauf 1 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 5 42 1 200 zeichen
lauf 3 env SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 6 42 1 200 zeichen
lauf 6 env SPIKE_BASELINES=8 SPIKE_MDMODUS=ueberschreiben $NODE mehrfach.mjs 4 42 1 200 zeichen

echo "# fertig: $A" >> "$OUT"
