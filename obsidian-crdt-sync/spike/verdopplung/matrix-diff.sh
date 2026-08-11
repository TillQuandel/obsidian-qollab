#!/bin/sh
# WARUM: Die Verdopplung (9982 ueber acht Zellen) soll einem Entstehungsort
# zugeordnet werden. `diffModus` steuert AUSSCHLIESSLICH die Op-Erzeugung in
# `CrdtManager.setContent` (`src/crdt-manager.ts:391 diffOps`). Faehrt man
# dieselben acht Zellen mit `roh`, `semantisch` und dem Standard `zeile`, ist die
# Differenz der Verdopplung genau der Anteil, den `setContent` traegt — ohne
# Produktivcode zu instrumentieren.
#
#   sh matrix-diff.sh <diffmodus> [zellen]
#     diffmodus: roh | semantisch | zeile | ganz   (leer = Standard)
#     zellen:    Ziffernfolge, z. B. "0123" (Standard: alle acht)
#
# Zellbasis WORTGLEICH zu `spike/schnitt/matrix-patch.sh` (200 Seeds x 10
# Notizen, patch=dreiwege = heutiger Stand), damit die Baseline
# `ergebnis-patch-dreiwege.txt` (verdopp=9982) direkt danebengelegt werden kann.
#
# FALLSTRICK, uebernommen aus matrix-patch.sh: hoechstens zwei dieser Stroeme
# parallel, sonst sprengt der Heap und der Lauf meldet „fertig" mit fehlenden
# Zeilen. Deshalb stderr ins Log.
cd "$(dirname "$0")/../schnitt" || exit 1
D="${1:-standard}"
Z="${2:-01234567}"
OUT="../verdopplung/ergebnis-diff-$D.txt"
: > "$OUT"
export SPIKE_BUNDLE=./real-neu.cjs
export SPIKE_PATCH=dreiwege
export SPIKE_NOTES=10
export SPIKE_EDITS=1
[ "$D" = "standard" ] || export QOLLAB_DIFF_MODUS="$D"
NODE="node --max-old-space-size=8192"

echo "# diffModus: $D   (je Zelle 200 Seeds x 10 Notizen, patch=dreiwege)" >> "$OUT"

lauf() {
  case "$Z" in *"$1"*) ;; *) return 0 ;; esac
  shift
  echo "  -> $*" >&2
  "$@" >> "$OUT" 2>&1
}

# Zellbasis und Referenz (diff=STANDARD, aus ergebnis-patch-dreiwege.txt):
# Z0 verdopp=845  Z1 1557  Z2 1483  Z3 2401  Z4 792  Z5 790  Z6 1056  Z7 1058
lauf 0 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
lauf 1 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 5 42 1 200 zeichen
lauf 2 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 5  7 1 200 zeichen
lauf 3 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 6 42 1 200 zeichen
lauf 4 env SPIKE_BASELINES=200  SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
lauf 5 env SPIKE_BASELINES=1000 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
lauf 6 env SPIKE_BASELINES=8    SPIKE_MDMODUS=ueberschreiben $NODE mehrfach.mjs 4 42 1 200 zeichen
lauf 7 env SPIKE_BASELINES=8    SPIKE_MDMODUS=ueberschreiben $NODE mehrfach.mjs 4  7 1 200 zeichen

echo "# fertig: $D" >> "$OUT"
