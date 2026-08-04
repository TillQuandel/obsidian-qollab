// DER DETEKTOR — fuehrt jeden Textzuwachs auf die erzeugende Codestelle zurueck.
//
// Nachbau des Werkzeugs aus Task 18 (`zzdiag.diagspec.ts`, nie committet, Worktree
// weg). Umhuellt sind die vier Stellen, an denen Text im System entstehen kann:
//   unionMerge / threeWayMerge  (src/text-merge)
//   CrdtManager.applyUpdate / CrdtManager.setContent
//
// GEBURTSKRITERIUM: Ein gezaehltes Token steht im ERGEBNIS oefter als in JEDER
// EINGABE. Dann hat genau dieser Aufruf das Duplikat erzeugt und es nicht bloss
// weitergereicht. Ein Aufruf, dessen Ergebnis ein Duplikat traegt, das schon in
// einer Eingabe stand, ist TRAEGER — getrennt gefuehrt, damit die Kette nicht
// jeden nachgelagerten Aufruf als Quelle meldet.
//
// Die Aufrufstelle kommt aus dem Stack (`Datei:Zeile`), damit `unionMerge` nicht
// als EINE Quelle erscheint, sondern als die Stellen, die es tatsaechlich sind.

import * as Y from 'yjs';
import { CrdtManager } from '../src/crdt-manager';
import * as textMerge from '../src/text-merge';
import { occ } from './invarianten';

export interface Ereignis {
  art: 'geburt' | 'traeger';
  funktion: string;
  stelle: string; // Datei:Zeile der AUFRUFSTELLE
  token: string;
  maxEingabe: number;
  ergebnis: number;
}

let aktiv = false;
let tokens: string[] = [];
let ereignisse: Ereignis[] = [];
// Zaehlt, wie oft jede Umhuellung tatsaechlich durchlaufen wurde. Steht ein
// Zaehler auf 0, hat das Patchen nicht gegriffen und keine Aussage ueber diese
// Funktion gilt.
export const durchlaeufe = { unionMerge: 0, threeWayMerge: 0, applyUpdate: 0, setContent: 0 };

export function detektorAn(tk: string[]): void {
  aktiv = true;
  tokens = tk;
  ereignisse = [];
}

export function detektorAus(): Ereignis[] {
  aktiv = false;
  return ereignisse;
}

export function zaehlerZuruecksetzen(): void {
  for (const k of Object.keys(durchlaeufe) as Array<keyof typeof durchlaeufe>) durchlaeufe[k] = 0;
}

function stelleFinden(): string {
  const s = new Error().stack ?? '';
  for (const z of s.split('\n').slice(2)) {
    if (z.includes('detektor.ts')) continue;
    const m = z.match(/([\w.@-]+\.ts):(\d+):\d+/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return 'unbekannt';
}

// `eingaben` sind die Texte, aus denen das Ergebnis hervorgeht. Faul ausgewertet:
// Die Sonde fuer `applyUpdate` ist teuer und wird nur gebaut, wenn ueberhaupt ein
// Token mehrfach im Ergebnis steht.
function pruefe(funktion: string, ergebnis: string, eingaben: () => string[]): void {
  if (!aktiv) return;
  let verdaechtig: Array<[string, number]> | null = null;
  for (const t of tokens) {
    const n = occ(ergebnis, t);
    if (n > 1) (verdaechtig ??= []).push([t, n]);
  }
  if (verdaechtig === null) return;
  const ein = eingaben();
  const stelle = stelleFinden();
  for (const [t, n] of verdaechtig) {
    const max = ein.length === 0 ? 0 : Math.max(...ein.map((e) => occ(e, t)));
    ereignisse.push({
      art: n > max ? 'geburt' : 'traeger',
      funktion,
      stelle,
      token: t,
      maxEingabe: max,
      ergebnis: n,
    });
  }
}

// Der Text eines Yjs-Updates. Sidecars tragen den vollen State
// (`encodeStateAsUpdate`), ein frischer Doc plus Update ergibt also den Stand des
// Absenders. Ist es nur ein Delta, liefert die Sonde weniger — dann faellt das
// Urteil hoechstens zu Gunsten von „Geburt" aus, was in der Auswertung sichtbar
// bleibt (`maxEingabe` steht dann unter dem Doc-Vorherstand).
function sondenText(update: Uint8Array): string {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return probe.getText('content').toString();
  } catch {
    return '';
  } finally {
    probe.destroy();
  }
}

export function detektorInstallieren(): void {
  const echtUnion = textMerge.unionMerge;
  const echtThree = textMerge.threeWayMerge;
  (textMerge as any).unionMerge = (a: string, b: string): string => {
    const r = echtUnion(a, b);
    durchlaeufe.unionMerge++;
    pruefe('unionMerge', r, () => [a, b]);
    return r;
  };
  (textMerge as any).threeWayMerge = (base: string, mine: string, theirs: string): string => {
    const r = echtThree(base, mine, theirs);
    durchlaeufe.threeWayMerge++;
    pruefe('threeWayMerge', r, () => [base, mine, theirs]);
    return r;
  };

  const echtApply = CrdtManager.prototype.applyUpdate;
  const echtSet = CrdtManager.prototype.setContent;
  CrdtManager.prototype.applyUpdate = function (filePath: string, update: Uint8Array): void {
    const vorher = this.getContent(filePath);
    echtApply.call(this, filePath, update);
    durchlaeufe.applyUpdate++;
    pruefe('applyUpdate', this.getContent(filePath), () => [vorher, sondenText(update)]);
  };
  CrdtManager.prototype.setContent = function (filePath: string, content: string): void {
    const vorher = this.getContent(filePath);
    echtSet.call(this, filePath, content);
    durchlaeufe.setContent++;
    // `setContent` zwingt den Doc auf `content`. Die Eingaben sind der Vorherstand
    // und der Zieltext — steht das Token danach oefter als in beiden, hat der
    // Diff-Apply es erzeugt.
    pruefe('setContent', this.getContent(filePath), () => [vorher, content]);
  };
}

// Verdichtung: Geburten je (Funktion, Stelle), Traeger getrennt.
export function verdichte(e: Ereignis[]): Map<string, { geburt: number; traeger: number }> {
  const m = new Map<string, { geburt: number; traeger: number }>();
  for (const x of e) {
    const k = `${x.funktion} @ ${x.stelle}`;
    const v = m.get(k) ?? { geburt: 0, traeger: 0 };
    if (x.art === 'geburt') v.geburt++;
    else v.traeger++;
    m.set(k, v);
  }
  return m;
}
