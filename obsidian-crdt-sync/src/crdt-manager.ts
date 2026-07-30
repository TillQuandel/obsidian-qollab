import * as Y from 'yjs';
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from 'diff-match-patch';

// Task 17/F-1: Trägt `update` nachweislich Yjs-Ops? Nötig, um einen echten
// v0.1-State (headerlos, aber gültig) von einer nur unvollständig
// materialisierten Datei zu unterscheiden — für `decodeStateFile` sehen beide
// identisch aus (`guid: null`). Läuft auf einem Wegwerf-Doc; kein geladener
// Zustand wird berührt.
//
// Task 17/R-1: „parst" genügt als Nachweis NICHT. Yjs liest `[0x00, 0x00]` als
// „0 Struct-Clients, 0 Delete-Set-Clients" und ignoriert den Rest — jeder
// nullgefüllte Puffer ab 2 Byte parst damit fehlerfrei zu einem leeren Doc, und
// `zeros(20) + <echtes Update>` (genullter Kopf, intakte Nutzlast) ebenfalls.
// Nullfüllung ist aber genau die zweite Erscheinungsform halb materialisierter
// Dateien (fehlgeschlagene OneDrive-Hydrierung, abgebrochener NTFS-Extend,
// Sparse-/Platzhalter-Zustände). Deshalb ist das Kriterium `clients.size > 0` —
// dieselbe Unterscheidung, die `hasOps` unten für den geladenen Doc trifft.
//
// Preis der Verschärfung: Ein LEGITIMER v0.1-State kann ops-frei sein — v0.1
// rief `saveState` auch für eine leere Note, und `encodeStateAsUpdate` eines
// nie befüllten Docs sind exakt die zwei Nullbytes. Eine solche Datei wird ab
// jetzt weder gelöscht noch gemergt, sondern als „Stand unbekannt" gemeldet.
// Verloren geht dabei nichts (sie trägt per Konstruktion keine Op); es bleibt
// eine 2-Byte-Datei liegen und eine Meldung pro Pfad und Sitzung. Umgekehrt
// kostete das schwächere Kriterium eine nullgefüllte Datei, die den vollen
// State trug — Löschung bzw. frische Inkarnation. Der Tausch ist einseitig.
export function carriesYjsOps(update: Uint8Array): boolean {
  if (update.length === 0) return false;
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return (probe.store as any).clients.size > 0;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}

export class CrdtManager {
  private dmp = new diff_match_patch();
  private docs = new Map<string, Y.Doc>();
  private disposed = false;

  private getOrCreate(filePath: string): Y.Doc {
    if (this.disposed) throw new Error('CrdtManager already disposed');
    if (!this.docs.has(filePath)) {
      this.docs.set(filePath, new Y.Doc());
    }
    return this.docs.get(filePath)!;
  }

  // Diff-basiertes Update: berechnet die minimalen Positions-Ops zwischen dem
  // aktuellen Doc-Text und content und wendet sie in EINER Transaktion an.
  // Unveränderte Zeichen behalten ihre Yjs-Item-IDs — dadurch dedupliziert der
  // Merge zweier Replikate statt zu konkatenieren. Rohe Diffs (kein
  // diff_cleanupSemantic): Positionsgenauigkeit vor Lesbarkeit.
  setContent(filePath: string, content: string): void {
    const doc = this.getOrCreate(filePath);
    const text = doc.getText('content');
    const current = text.toString();
    if (current === content) return;

    const diffs = this.dmp.diff_main(current, content);
    doc.transact(() => {
      let pos = 0;
      for (const [op, data] of diffs) {
        if (op === DIFF_EQUAL) {
          pos += data.length;
        } else if (op === DIFF_INSERT) {
          text.insert(pos, data);
          pos += data.length;
        } else if (op === DIFF_DELETE) {
          text.delete(pos, data.length);
        }
      }
    });
  }

  hasDoc(filePath: string): boolean {
    return this.docs.has(filePath);
  }

  // Prüft ob der Doc tatsächlich Ops enthält (State-Vector nicht leer).
  // Ein frischer Y.Doc ohne jegliche Edits hat store.clients.size === 0.
  // Nach setContent (Insert-Ops) oder Delete-Ops ist clients.size > 0.
  // Wird von Guard 2 (onRemoteYjsUpdate) genutzt, um einen historienlosen
  // Frisch-Doc von einer echten Leerung (User hat allen Text gelöscht) zu
  // unterscheiden.
  hasOps(filePath: string): boolean {
    if (!this.docs.has(filePath)) return false;
    return (this.docs.get(filePath)!.store as any).clients.size > 0;
  }

  getContent(filePath: string): string {
    if (!this.docs.has(filePath)) return '';
    return this.docs.get(filePath)!.getText('content').toString();
  }

  encodeState(filePath: string): Uint8Array {
    return Y.encodeStateAsUpdate(this.getOrCreate(filePath));
  }

  applyUpdate(filePath: string, update: Uint8Array): void {
    Y.applyUpdate(this.getOrCreate(filePath), update);
  }

  mergeAndGet(filePath: string, remoteState: Uint8Array): string {
    this.applyUpdate(filePath, remoteState);
    return this.getContent(filePath);
  }

  disposeDoc(filePath: string): void {
    this.docs.get(filePath)?.destroy();
    this.docs.delete(filePath);
  }

  disposeAll(): void {
    this.disposed = true;
    for (const doc of this.docs.values()) doc.destroy();
    this.docs.clear();
  }
}
