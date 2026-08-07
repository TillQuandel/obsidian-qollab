// DIE SAAT-KENNUNG — der Kandidat aus `spike/zzOP5-saat-kennung.spec.ts`
// (Branch `mess/verdopplung`, Commit `d1fe170`), hier als SCHALTER am Harness.
//
// DIE IDEE DORT: Entsteht dieselbe Notiz auf zwei Geraeten unabhaengig, gibt es
// keinen gemeinsamen Vorfahren — beim Treffen wird verkettet statt dedupliziert.
// Statt die Saat-Transaktion (den ERSTEN `insert` beim Erfassen einer Notiz)
// unter einer zufaelligen clientID laufen zu lassen, laeuft sie unter einer aus
// dem SAATTEXT abgeleiteten. Zwei Geraete, die denselben Text erfassen, erzeugen
// dann BYTEGLEICHE Items — der Vorfahre existiert.
//
// WOERTLICH UEBERNOMMEN aus d1fe170 (Zeilen 55-72 dort):
//
//   // FNV-1a ueber UTF-16-Einheiten, beide Bytes. Deterministisch, keine
//   // Abhaengigkeit.
//   export function saatKennung(text: string): number { ... }
//
//   /** Ein Geraet: Doc mit gc:false, Saat unter der Inhalts-Kennung, danach
//    *  Zufall. */
//   function geraet(saat: string, eigeneKennung: number, saatKennungAn: boolean) {
//     const d = new Y.Doc({ gc: false });
//     (d as any).clientID = saatKennungAn ? saatKennung(saat) : eigeneKennung;
//     d.getText(T).insert(0, saat);
//     (d as any).clientID = eigeneKennung; // ab hier alle Nutzer-Edits
//     return d;
//   }
//
// ZWEI ABWEICHUNGEN, beide erzwungen und beide ausdruecklich:
//
//   1. `gc: false` fehlt hier. Der Original-Spike baut seine Docs selbst; dieser
//      Harness laeuft gegen den PRODUKTIVEN `CrdtManager`, und der legt
//      `new Y.Doc()` an (`crdt-manager.ts:252`). `src/` bleibt unberuehrt, also
//      bleibt auch die GC-Einstellung die des Produkts.
//   2. Der Saatmoment ist hier nicht ein handgeschriebener `insert`, sondern der
//      erste `setContent` auf einem Doc OHNE Ops. Das ist derselbe Moment: im
//      Produkt entsteht die Inkarnation im Adopt-Zweig von `ensureDoc`
//      (`sync-handler.ts:1307`) ueber genau diesen Aufruf.
//
// KEINE Aenderung in `src/`.

import type * as Y from 'yjs';
import { CrdtManager } from '../src/crdt-manager';

// FNV-1a ueber UTF-16-Einheiten, beide Bytes. Deterministisch, keine
// Abhaengigkeit. (Woertlich aus d1fe170.)
export function saatKennung(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ (c >>> 8), 0x01000193) >>> 0;
  }
  return (h >>> 0) || 1;
}

// 'zufall' — Bestand: jede Saat laeuft unter der zufaelligen clientID des Docs.
// 'saat'   — der Kandidat.
export type Kennung = 'zufall' | 'saat';

export class SaatCrdtManager extends CrdtManager {
  kennung: Kennung = 'zufall';
  // GEGENPROBE: jede Kennung, unter der dieser Manager eine Notiz gepraegt hat.
  // Ohne diese Liste waere „keine Wirkung gemessen" nicht von „Schalter tot" zu
  // unterscheiden — und genau das ist bei einem Verfahren, das Identitaet aus
  // Text ableitet, der wahrscheinlichste Fehlschluss.
  readonly gepraegt: number[] = [];

  setContent(filePath: string, content: string): void {
    // Nur der ERSTE Inhalt eines Docs ohne Ops ist die Saat. Ein Doc, das aus
    // dem eigenen State oder einer fremden Hilfsdatei aufgebaut wurde, traegt
    // bereits eine Inkarnation — dort waere die Ableitung falsch.
    if (this.kennung !== 'saat' || content === '' || this.hasOps(filePath)) {
      super.setContent(filePath, content);
      return;
    }
    // `getOrCreate` ist in `CrdtManager` privat; `private` ist in TypeScript
    // reine Uebersetzungszeit, zur Laufzeit ist die Methode da. Der Zugriff
    // steht hier statt in `src/` genau deshalb: der Produktivcode bleibt heil.
    const doc = (this as unknown as { getOrCreate(p: string): Y.Doc }).getOrCreate(filePath);
    const alt = doc.clientID;
    const neu = saatKennung(content);
    (doc as { clientID: number }).clientID = neu;
    try {
      super.setContent(filePath, content);
    } finally {
      // Ab hier wieder die eigene Kennung — alle Nutzer-Edits laufen unter ihr.
      (doc as { clientID: number }).clientID = alt;
    }
    this.gepraegt.push(neu);
  }
}
