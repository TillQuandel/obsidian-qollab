// Deterministische Yjs-clientIDs.
//
// Schwesterdatei zu `guid-quelle.ts` — und der Grund, warum die dort nicht
// reicht: Yjs zieht `doc.clientID` aus `random.uint32` (yjs.cjs:422), und das
// ist `webcrypto.getRandomValues(new Uint32Array(1))[0]` aus lib0. Unter Node
// loest `lib0/webcrypto` auf `webcrypto.node.cjs` auf, und die Datei bindet
// `getRandomValues` BEIM LADEN an `node:crypto`:
//
//     const getRandomValues = webcrypto.getRandomValues.bind(webcrypto)
//
// `guid-quelle.ts` ersetzt `globalThis.crypto.getRandomValues`. Das erreicht die
// bereits gebundene Referenz nie — gemessen: zwei `new Y.Doc()` liefern mit
// gepatchtem `globalThis.crypto` weiterhin verschiedene IDs. `Math.random` ist
// ebenfalls die falsche Fahrte: lib0 speist daraus nur `rand`/`oneOf`, die yjs
// fuer clientIDs nicht anfasst.
//
// Wirksam ist genau ein Punkt: das Modul-Objekt `lib0/webcrypto` selbst.
// `random.cjs` greift bei JEDEM Aufruf ueber `webcrypto.getRandomValues(...)`
// darauf zu, also wirkt ein Austausch dort sofort und rueckwirkend.
//
// WARUM DAS NOETIG IST: Die clientID entscheidet den YATA-Tie-Break bei
// nebenlaeufigen Einfuegungen. Verfahren, die EIGENE Ops erzeugen
// (`korrigieren` via `setContent`), haengen davon ab; Verfahren, die aus
// fremden Updates aufbauen (`applyUpdate` uebertraegt die Original-IDs), nicht.
// Genau dieses Muster zeigte die Messung: `ersetzen` und `adoptieren` bitgleich,
// `korrigieren` schwankend.
//
// WAS DER SEED NICHT TUT: Er friert den Tie-Break nicht auf eine Richtung ein.
// Der Seed wird aus der Konfiguration des Laufs abgeleitet, also streut er ueber
// die Zellen wie zuvor — nur eben reproduzierbar. Gleiche Konfiguration =>
// gleiche Folge, verschiedene Konfiguration => verschiedene Folge.

/* eslint-disable @typescript-eslint/no-var-requires */
const webcrypto = require('lib0/webcrypto');

const echt: ((arr: ArrayBufferView) => ArrayBufferView) | undefined = webcrypto.getRandomValues;

let zustand = 1;

// mulberry32 — 32 Bit Zustand, volle Periode, keine Abhaengigkeit von Uhr oder
// Plattform. Reicht fuer einen Tie-Break-Wuerfel; es geht hier nicht um
// kryptografische Guete, sondern um Wiederholbarkeit.
function naechste(): number {
  zustand = (zustand + 0x6d2b79f5) | 0;
  let t = zustand;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export function setzeZufallSeed(seed: number): void {
  // 0 waere ein zulaessiger, aber unnoetig unauffaelliger Startpunkt.
  zustand = (seed | 0) === 0 ? 1 : seed | 0;
}

export function zufallQuelleAn(): void {
  webcrypto.getRandomValues = (arr: { length: number; [i: number]: number }) => {
    for (let i = 0; i < arr.length; i++) arr[i] = naechste();
    return arr;
  };
}

export function zufallQuelleAus(): void {
  if (echt) webcrypto.getRandomValues = echt;
}

// FNV-1a 32. Die Kollisionsgrenze, die diesen Hash im Produktivcode
// disqualifiziert, spielt hier keine Rolle: zwei Konfigurationen mit demselben
// Seed sind trotzdem zwei verschiedene Laeufe — der Seed muss nur ueber
// WIEDERHOLUNGEN stabil und ueber die Zellen gestreut sein.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// NUR die Felder, die `lauf.ts` und `lauf-n.ts` gemeinsam haben. Das ist kein
// Versehen: `zz7-achsen` kalibriert die beiden Treiber gegeneinander und
// verlangt bei N=2/M=1 identische Zahlen. Zoege `laufN` seinen Seed aus `N`
// oder `M` mit, waere die Kennungsfolge dort eine andere und die Kalibrierung
// bräche — an einer Stelle, die mit dem Messgegenstand nichts zu tun hat.
export interface SeedFelder {
  szenario: string;
  editfall: string;
  reihenfolge: number[];
  aWinnt: boolean;
  konfliktModus: string;
  sperreBis: number;
  externEdit?: boolean;
}

// Der Determinismus friert EINE Realisierung der clientID-Folge ein. Die
// gemessenen Zahlen gelten damit fuer genau diese — ein anderer Seed kann andere
// liefern. Ueber diese Variable laesst sich derselbe Aufbau mit einer anderen
// Familie fahren; bleibt die Rangfolge der Verfahren stehen, haengt sie nicht am
// Wuerfel. Ohne die Variable aendert sich nichts.
const OFFSET = Number(process.env.SPIKE_SEED_OFFSET ?? 0);

export function seedAusKonfig(k: SeedFelder): number {
  return (OFFSET + fnv1a(
    JSON.stringify([
      k.szenario,
      k.editfall,
      k.reihenfolge,
      k.aWinnt,
      k.konfliktModus,
      k.sperreBis,
      !!k.externEdit,
    ])
  )) >>> 0;
}
