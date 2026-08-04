// Der Datei-Sync als eigene Schicht — NICHT als direkte Geraet-zu-Geraet-Kopie.
//
// Warum das noetig ist (der erste Entwurf war falsch): Eine direkte Kopie in
// beide Richtungen tauscht die `.md` gegenseitig aus und konvergiert nie; das
// misst den Transport, nicht das Plugin. Ein echter Datei-Sync hat EINEN Stand je
// Pfad. Verzoegerung entsteht durch die Trennung von HOCHLADEN und
// HERUNTERLADEN: schreibt ein Geraet zweimal und laedt dazwischen nicht hoch,
// sieht der Peer die AELTERE Fassung — genau der „veraltete Sidecar", aus dem die
// belegte Kausalkette (U3) entsteht.
//
// Konfliktkopien sind mitmodelliert. Sie sind kein Zusatz, sondern Pflicht: ohne
// eigene Hilfsdatei ist der Datei-Sync das einzige Netz, und wer eine Variante
// gegen ein „Nichts" misst, das es nie gab, schreibt sich einen Gewinn gut.

import type { Geraet } from './geraet';

interface Eintrag {
  bytes?: ArrayBuffer;
  text?: string;
  v: number;
}

interface Sicht {
  v: number;
  text?: string; // Inhalt, wie ihn dieses Geraet zuletzt mit der Wolke abgeglichen hat
}

export class Wolke {
  private stand = new Map<string, Eintrag>();
  private gesehen = new Map<string, Map<string, Sicht>>();
  // Konfliktkopien je Geraet. Bewusst NICHT im Vault des Geraets: Qollab wuerde
  // sie sonst als eigene Note aufnehmen. Sie zaehlen als „sichtbar auf der
  // Platte, aber Handarbeit".
  readonly kopien = new Map<string, string[]>();
  private version = 0;

  // 'kopie' — der Datei-Sync loest konkurrierende `.md`-Schreibvorgaenge wie
  //           OneDrive: Wolken-Fassung gewinnt lokal, die eigene wird zur Kopie.
  // 'ohne'  — der `.md`-Kanal wird stillgelegt, solange eine Seite unsynchrone
  //           lokale Aenderungen hat. Damit traegt allein der CRDT-Kanal, und
  //           die Praegung ist isoliert messbar. (Derselbe Kunstgriff wie
  //           `noMdConflict` in den Vorarbeiten — kuenstlich, aber notwendig:
  //           mit Konfliktkopien ist die KONTROLLE genauso rot wie der Testfall.)
  konfliktModus: 'kopie' | 'ohne' = 'kopie';

  constructor(geraete: Geraet[]) {
    for (const g of geraete) {
      this.gesehen.set(g.id, new Map());
      this.kopien.set(g.id, []);
    }
  }

  private sicht(g: Geraet, pfad: string): Sicht {
    return this.gesehen.get(g.id)!.get(pfad) ?? { v: -1 };
  }
  private merke(g: Geraet, pfad: string, v: number, text?: string): void {
    this.gesehen.get(g.id)!.set(pfad, { v, text });
  }

  // Anfangsbestand: eine Datei, die beide Geraete schon haben (der Regelfall —
  // ein Vault, der vor Qollab existierte).
  saeen(geraete: Geraet[], notePath: string, text: string): void {
    const v = ++this.version;
    this.stand.set(notePath, { text, v });
    for (const g of geraete) {
      g.setMd(notePath, text);
      this.merke(g, notePath, v, text);
    }
  }

  // ---- Hochladen ----------------------------------------------------------

  ladeMdHoch(g: Geraet, notePath: string): void {
    const lokal = g.vault._textFiles.get(notePath);
    if (lokal === undefined) return;
    const s = this.sicht(g, notePath);
    if (lokal === s.text) return; // lokal nichts geaendert
    const eintrag = this.stand.get(notePath);
    if (eintrag && eintrag.v > s.v) {
      // Beide haben seit dem letzten Abgleich geaendert.
      if (this.konfliktModus === 'ohne') return; // Kanal ruht, nichts geht verloren
      this.kopien.get(g.id)!.push(lokal);
      return;
    }
    const v = ++this.version;
    this.stand.set(notePath, { text: lokal, v });
    this.merke(g, notePath, v, lokal);
  }

  ladeSidecarsHoch(g: Geraet): void {
    for (const [pfad, bytes] of g.vault._files as Map<string, ArrayBuffer>) {
      if (!pfad.endsWith(`.${g.id}.yjs`)) continue;
      const alt = this.stand.get(pfad);
      if (alt && gleich(alt.bytes!, bytes)) continue;
      const v = ++this.version;
      this.stand.set(pfad, { bytes: bytes.slice(0), v });
      this.merke(g, pfad, v);
    }
  }

  // ---- Herunterladen ------------------------------------------------------

  // true, wenn die lokale `.md` dabei ueberschrieben wurde (dort feuert in
  // Obsidian ein modify-Event).
  ladeMdHerunter(g: Geraet, notePath: string): boolean {
    const eintrag = this.stand.get(notePath);
    if (!eintrag || eintrag.text === undefined) return false;
    const s = this.sicht(g, notePath);
    if (eintrag.v <= s.v) return false;
    const lokal = g.vault._textFiles.get(notePath);
    if (lokal !== undefined && s.text !== undefined && lokal !== s.text) {
      // Lokal geaendert, Wolke ebenfalls.
      if (this.konfliktModus === 'ohne') return false; // Kanal ruht
      // Sonst: unsere Fassung wird zur Kopie, die Wolken-Fassung ersetzt sie
      // lokal (OneDrive-Verhalten).
      this.kopien.get(g.id)!.push(lokal);
    }
    this.merke(g, notePath, eintrag.v, eintrag.text);
    if (lokal === eintrag.text) return false;
    g.setMd(notePath, eintrag.text);
    return true;
  }

  ladeSidecarsHerunter(g: Geraet): boolean {
    let etwas = false;
    for (const [pfad, eintrag] of this.stand) {
      if (eintrag.bytes === undefined) continue;
      if (pfad.endsWith(`.${g.id}.yjs`)) continue; // eigene Datei nie zurueckziehen
      if (eintrag.v <= this.sicht(g, pfad).v) continue;
      g.vault._files.set(pfad, eintrag.bytes.slice(0));
      g.vault._mtimes.set(pfad, (g.vault._mtimes.get(pfad) ?? 0) + 1);
      this.merke(g, pfad, eintrag.v);
      etwas = true;
    }
    return etwas;
  }

  alleKopien(): string[] {
    return [...this.kopien.values()].flat();
  }
}

function gleich(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
