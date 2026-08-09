#!/bin/sh
# Vergleichsmatrix der beiden Hebel. Aufruf: sh hebel-matrix.sh <N> <DET> [von] [bis]
# Ergebnis wird an ergebnis-hebel-2026-08-09.txt angehaengt.
N=$1; DET=$2; VON=${3:-1}; BIS=${4:-200}
OUT=ergebnis-hebel-2026-08-09.txt
for M in zeichen zeile tor zeile+tor; do
  SPIKE_BUNDLE=./real-neu.cjs node mehrfach.mjs "$N" "$DET" "$VON" "$BIS" "$M" 2>&1 | grep '^==' | tee -a "$OUT"
done
