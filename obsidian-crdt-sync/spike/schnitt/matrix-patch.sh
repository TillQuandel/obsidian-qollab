#!/bin/sh
# Eine patch_apply-Variante ueber die Zellen fahren, in denen unter dem heutigen
# Stand (`diffModus = 'zeile'`) noch Grundtext verloren geht — plus Z0 als
# Regressionswaechter (dort ist WEG bereits 0, eine Verschlechterung faellt auf).
#
#   sh matrix-patch.sh <variante> [zellen]
#     variante: bestand | kein-fuzz | exakt-nah | nur-exakt | melden | melden-voll
#     zellen:   Ziffernfolge, z. B. "34567" (Standard: alle)
#
# Referenzwerte je Zelle stehen als Kommentar dahinter, wortgleich aus
# `ergebnis-achsen-2026-08-10.txt` (Spalte diff=STANDARD).
#
# ZWEI FALLSTRICKE, real bezahlt:
#  - Vier dieser Laeufe parallel sprengen den Heap. Die textreicheren Varianten
#    (`bestand`) sterben bei N=6 und grossen Notizen zuerst, weil sie mehr
#    Yjs-Items tragen. Deshalb `--max-old-space-size` und hoechstens zwei Stroeme.
#  - `grep '^=='` verschluckt jede Fehlermeldung. Der Abbruch sah wie ein
#    fertiger Lauf mit fehlenden Zeilen aus. Deshalb landet stderr im Log.
cd "$(dirname "$0")" || exit 1
V="${1:-bestand}"
Z="${2:-01234567}"
OUT="ergebnis-patch-$V.txt"
: > "$OUT"
export SPIKE_BUNDLE=./real-neu.cjs
export SPIKE_PATCH="$V"
export SPIKE_NOTES=10
export SPIKE_EDITS=1
NODE="node --max-old-space-size=8192"

echo "# patch_apply-Variante: $V   (je Zelle 200 Seeds x 10 Notizen)" >> "$OUT"

lauf() { # lauf <ziffer> <label>
  case "$Z" in *"$1"*) ;; *) return 0 ;; esac
  shift
  echo "  -> $*" >&2
  "$@" >> "$OUT" 2>&1
}

# Z0  Regressionswaechter          Bestand: WEG=0 verlust=112 verdopp=902 div=0
lauf 0 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
# Z1  N=5                          Bestand: WEG=3 verlust=205 verdopp=1662 div=0
lauf 1 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 5 42 1 200 zeichen
# Z2  N=5, andere Familie          Bestand: WEG=2 verlust=193 verdopp=1589 div=1
lauf 2 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 5  7 1 200 zeichen
# Z3  N=6                          Bestand: WEG=8 verlust=300 verdopp=2614 div=0
lauf 3 env SPIKE_BASELINES=8    SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 6 42 1 200 zeichen
# Z4  grosse Notiz, 200 Zeilen     Bestand: WEG=3 verlust=98 verdopp=807 div=0
lauf 4 env SPIKE_BASELINES=200  SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
# Z5  grosse Notiz, 1000 Zeilen    Bestand: WEG=5 verlust=100 verdopp=805 div=0
lauf 5 env SPIKE_BASELINES=1000 SPIKE_MDMODUS=kopie          $NODE mehrfach.mjs 4 42 1 200 zeichen
# Z6  ueberschreiben               Bestand: WEG=1 verlust=335 verdopp=1129 div=1
lauf 6 env SPIKE_BASELINES=8    SPIKE_MDMODUS=ueberschreiben $NODE mehrfach.mjs 4 42 1 200 zeichen
# Z7  ueberschreiben, andere Fam.  Bestand: WEG=1 verlust=336 verdopp=1164 div=0
lauf 7 env SPIKE_BASELINES=8    SPIKE_MDMODUS=ueberschreiben $NODE mehrfach.mjs 4  7 1 200 zeichen

echo "# fertig: $V" >> "$OUT"
