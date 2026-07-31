// Zeichen ausserhalb der Basisebene überleben den zeichenweisen Diff
//
// Gefunden in der Szenariosuche (Linse „Daten und Zeichen", 2026-07-31),
// vom Orchestrator nachgemessen. `diff-match-patch` UND `Y.Text` arbeiten beide
// auf UTF-16-Einheiten. Ein Emoji ist dort zwei Einheiten (ein Surrogatpaar),
// und der Diff setzt die Op-Grenze bereitwillig mitten hinein:
//
//   'Stimmung: 😀' → 'Stimmung: 😁'
//   diff_main:  EQUAL "\uD83D" · DELETE "\uDE00" · INSERT "\uDE01"
//
// `Y.Text` splittet den ContentString an dieser Grenze und ersetzt das
// verwaiste Halbzeichen durch U+FFFD — gemessen:
//
//   … 20 fffd de01 0a      statt      … 20 1f601 0a
//
// Das ist Datenkorruption, keine Duplikation: Nach dem ersten Edit sieht die
// `.md` noch richtig aus (`merged === content`, also kein Write-Back und keine
// Meldung), aber der Doc ist bereits kaputt. Der nächste, voellig unabhängige
// Edit setzt darauf auf, und der Write-Back traegt die Korruption in die Datei
// und ueber die Hilfsdatei zum anderen Geraet. Auf der Platte stehen dann
// `ef bf bd` statt `f0 9f 98 81` — nicht wiederherstellbar.
//
// Es braucht dafuer kein zweites Geraet und keinen Sync.
import { CrdtManager } from '../src/crdt-manager';

const N = 'note.md';

// Zeigt die Codepoints, damit ein Fehlschlag sofort lesbar ist statt als
// unsichtbarer Zeichensalat.
function cps(s: string): string {
  return [...s].map((c) => c.codePointAt(0)!.toString(16)).join(' ');
}

describe('Zeichen ausserhalb der Basisebene', () => {
  it('Emoji durch Emoji ersetzen (Op-Grenze faellt mitten ins Paar)', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Stimmung: \u{1F600}\n');
    mgr.setContent(N, 'Stimmung: \u{1F601}\n');
    expect(cps(mgr.getContent(N))).toBe(cps('Stimmung: \u{1F601}\n'));
  });

  it('Hautton eines Emoji wechseln', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Hallo \u{1F44D}\u{1F3FB}\n');
    mgr.setContent(N, 'Hallo \u{1F44D}\u{1F3FD}\n');
    expect(cps(mgr.getContent(N))).toBe(cps('Hallo \u{1F44D}\u{1F3FD}\n'));
  });

  it('ein Emoji aus einem Paar loeschen', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, 'a\u{1F600}\u{1F601}b\n');
    mgr.setContent(N, 'a\u{1F601}b\n');
    expect(cps(mgr.getContent(N))).toBe(cps('a\u{1F601}b\n'));
  });

  it('Emoji vor bestehenden Text setzen', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Titel\n');
    mgr.setContent(N, '\u{1F680} Titel\n');
    expect(cps(mgr.getContent(N))).toBe(cps('\u{1F680} Titel\n'));
  });

  it('seltenes CJK-Zeichen ersetzen (dieselbe Klasse, kein Emoji)', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Zeichen: \u{20000}\n');
    mgr.setContent(N, 'Zeichen: \u{20001}\n');
    expect(cps(mgr.getContent(N))).toBe(cps('Zeichen: \u{20001}\n'));
  });

  it('mehrere Emoji in einer Runde aendern', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, '\u{1F600} eins\n\u{1F600} zwei\n\u{1F600} drei\n');
    mgr.setContent(N, '\u{1F601} eins\n\u{1F600} zwei\n\u{1F602} drei\n');
    expect(cps(mgr.getContent(N))).toBe(cps('\u{1F601} eins\n\u{1F600} zwei\n\u{1F602} drei\n'));
  });

  it('der Schaden bleibt auch ueber einen zweiten, unabhaengigen Edit aus', () => {
    // Das ist der Weg, auf dem die Korruption real in die Datei kommt: Der
    // erste Edit beschaedigt nur den Doc, der zweite schreibt ihn zurueck.
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Stimmung: \u{1F600}\nZweite Zeile.\n');
    mgr.setContent(N, 'Stimmung: \u{1F601}\nZweite Zeile.\n');
    mgr.setContent(N, 'Stimmung: \u{1F601}\nZweite Zeile geaendert.\n');
    expect(cps(mgr.getContent(N))).toBe(cps('Stimmung: \u{1F601}\nZweite Zeile geaendert.\n'));
  });

  it('Kontrolle: Zeichen der Basisebene sind unbetroffen', () => {
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Kaese ä\n');
    mgr.setContent(N, 'Kaese ö\n');
    expect(mgr.getContent(N)).toBe('Kaese ö\n');
  });

  it('Kontrolle: die Op-Sparsamkeit bleibt erhalten', () => {
    // Der Sinn des zeichenweisen Diffs ist, unveraenderte Zeichen bei ihren
    // Item-IDs zu lassen. Die Ausrichtung darf daraus kein Voll-Ersetzen machen.
    const mgr = new CrdtManager();
    mgr.setContent(N, 'Zeile eins\nZeile zwei\n\u{1F600}\n');
    const vorher = mgr.encodeState(N).length;
    mgr.setContent(N, 'Zeile eins\nZeile zwei\n\u{1F601}\n');
    const nachher = mgr.encodeState(N).length;
    // Ein geaendertes Emoji darf den State nicht um die ganze Textlaenge wachsen
    // lassen — ein paar Dutzend Byte sind erwartbar, 200+ waeren ein Neuaufbau.
    expect(nachher - vorher).toBeLessThan(200);
  });
});
