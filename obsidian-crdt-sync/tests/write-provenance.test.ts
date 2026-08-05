// Tests für die Schreibspur (src/write-provenance.ts).
//
// Jeder der sieben an echtem Obsidian gemessenen Fallstricke hat hier genau
// einen Wächter — die Kommentare nennen jeweils, was ohne die betreffende
// Codezeile passiert, nicht was der Test tut.

import { WriteProvenance, textSchluessel, MAX_STAENDE } from '../src/write-provenance';

// Minimaler DataAdapter-Doppelgänger: nur write/process/append, die drei als
// `@public` dokumentierten Schreibwege, über die JEDER prozessinterne Schreibvorgang
// läuft. `sperren()` parkt den nächsten Aufruf, bis der Test ihn freigibt — nur so
// lässt sich der Zustand WÄHREND eines laufenden Writes beobachten.
function adapterMock() {
  const inhalte = new Map<string, string>();
  let sperre: Promise<void> | null = null;
  let oeffne: (() => void) | null = null;

  return {
    inhalte,
    sperren(): void {
      sperre = new Promise<void>((r) => {
        oeffne = r;
      });
    },
    freigeben(): void {
      oeffne?.();
      sperre = null;
      oeffne = null;
    },
    async write(pfad: string, text: string): Promise<void> {
      if (sperre) await sperre;
      inhalte.set(pfad, text);
    },
    async process(pfad: string, fn: (data: string) => string): Promise<string> {
      const neu = fn(inhalte.get(pfad) ?? '');
      if (sperre) await sperre;
      inhalte.set(pfad, neu);
      // Bewusst `undefined` statt des neuen Textes: Obsidians `process` löst laut
      // Typings mit dem Inhalt auf, aber die Schreibspur darf sich darauf nicht
      // stützen — eine fremde Umhüllung darüber kann den Wert verschlucken.
      return undefined as unknown as string;
    },
    async append(pfad: string, text: string): Promise<void> {
      if (sperre) await sperre;
      inhalte.set(pfad, (inhalte.get(pfad) ?? '') + text);
    },
  };
}

describe('WriteProvenance — Grundverhalten', () => {
  it('erkennt einen selbst geschriebenen Text wieder, fremden nicht', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();

    await a.write('note.md', 'Von uns geschrieben');

    expect(wp.istEigen('note.md', 'Von uns geschrieben')).toBe(true);
    // Der Fall, um den es geht: dieselbe Datei, aber der Inhalt kam per
    // Datei-Sync von außen an.
    expect(wp.istEigen('note.md', 'Von Syncthing geliefert')).toBe(false);
  });

  it('kennt einen nie geschriebenen Pfad nicht', () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();

    expect(wp.istEigen('fremd.md', 'irgendwas')).toBe(false);
  });

  it('install ist idempotent — keine doppelte Umhüllung', () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    const nachErstem = a.write;
    wp.install();

    expect(a.write).toBe(nachErstem);
  });

  it('nach uninstall wird nichts mehr gemerkt', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    wp.uninstall();

    await a.write('note.md', 'Text');

    expect(wp.istEigen('note.md', 'Text')).toBe(false);
  });
});

describe('WriteProvenance — Fallstrick 1: process merkt synchron in der Callback-Umhüllung', () => {
  it('kennt den Endstand eines process-Aufrufs, ohne dessen Auflösungswert zu lesen', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    a.inhalte.set('note.md', 'alt');

    await a.process('note.md', (d) => d + ' plus neu');

    // Der Mock löst mit `undefined` auf — der Stand kann nur aus der Umhüllung
    // von `fn` stammen. Wer stattdessen das Promise abwartet, steht hier ohne
    // Stand da und stuft den eigenen Text später als fremd ein.
    expect(wp.istEigen('note.md', 'alt plus neu')).toBe(true);
    expect(wp.istEigen('note.md', 'alt')).toBe(false);
  });

  it('der Stand steht schon fest, während der process-Aufruf noch läuft', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    a.inhalte.set('note.md', 'alt');
    a.sperren();

    const p = a.process('note.md', (d) => d + ' plus neu');
    // Obsidian feuert `modify` noch WÄHREND des Schreibvorgangs. Zu diesem
    // Zeitpunkt ist das Promise nicht aufgelöst — der Endstand muss trotzdem
    // schon bekannt sein.
    expect(wp.istEigen('note.md', 'alt plus neu')).toBe(true);

    a.freigeben();
    await p;
    expect(wp.istEigen('note.md', 'alt plus neu')).toBe(true);
  });
});

describe('WriteProvenance — Fallstrick 2: append liefert nur das Fragment', () => {
  it('merkt das append-Fragment nicht als Volltext', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    await a.write('note.md', 'Anfang');

    await a.append('note.md', ' Ende');

    expect(a.inhalte.get('note.md')).toBe('Anfang Ende');
    // Das Fragment war nie ein Dateistand. Wer es wie einen Volltext merkt,
    // hält später eine fremd gelieferte Datei mit genau diesem Inhalt für eigen.
    expect(wp.istEigen('note.md', ' Ende')).toBe(false);
  });

  it('deckt die Laufzeit des append-Aufrufs trotzdem über den Pfadzähler ab', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    await a.write('note.md', 'Anfang');
    a.sperren();

    const p = a.append('note.md', ' Ende');
    expect(wp.istEigen('note.md', 'Anfang Ende')).toBe(true);

    a.freigeben();
    await p;
  });
});

describe('WriteProvenance — Fallstrick 3: der Laufzeitzähler ist pfadbezogen', () => {
  it('ein laufender Write auf einem Pfad adelt keinen anderen Pfad', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    a.sperren();

    // Über `append`, denn nur dort trägt der Zähler noch: Bei `write`/`process`
    // steht der Endstand synchron vor dem Aufruf fest, dort entscheidet die
    // Inhaltsregel und der Zähler ist bewusst ausgeschaltet.
    const p = a.append('eigen.md', ' Fragment');

    expect(wp.istEigen('eigen.md', 'beliebiger Zwischenstand')).toBe(true);
    // Ein globaler Zähler stünde hier ebenfalls auf >0 und würde die von außen
    // gelieferte fremd.md als eigene Änderung durchwinken.
    expect(wp.istEigen('fremd.md', 'Von OneDrive geliefert')).toBe(false);

    a.freigeben();
    await p;
  });
});

describe('WriteProvenance — Fallstrick 4: begrenzte Standhistorie', () => {
  it(`hält nur die letzten ${MAX_STAENDE} Stände je Pfad`, async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();

    for (let i = 1; i <= MAX_STAENDE + 1; i++) await a.write('note.md', `Stand ${i}`);

    // Der älteste fällt heraus — bei 1600+ Notizen wäre eine unbegrenzte Liste
    // ein stiller Speicherfresser.
    expect(wp.istEigen('note.md', 'Stand 1')).toBe(false);
    for (let i = 2; i <= MAX_STAENDE + 1; i++) {
      expect(wp.istEigen('note.md', `Stand ${i}`)).toBe(true);
    }
  });
});

describe('WriteProvenance — Fallstrick 5: uninstall respektiert fremde Umhüllungen', () => {
  it('setzt die Originalmethode zurück, wenn die eigene Umhüllung noch obenauf liegt', () => {
    const a = adapterMock();
    const original = a.write;
    const wp = new WriteProvenance(a);

    wp.install();
    expect(a.write).not.toBe(original);

    wp.uninstall();
    expect(a.write).toBe(original);
  });

  it('lässt eine später gesetzte fremde Umhüllung stehen und schaltet sich nur inaktiv', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();

    // Ein anderes Plugin umhüllt NACH uns — unsere Schicht liegt jetzt darunter.
    const fremdLog: string[] = [];
    const darunter = a.write.bind(a);
    a.write = function (pfad: string, text: string): Promise<void> {
      fremdLog.push(pfad);
      return darunter(pfad, text);
    };
    const fremd = a.write;

    wp.uninstall();

    // Blindes Zurücksetzen schnitte die fremde Schicht aus der Kette — das
    // andere Plugin bekäme seine Aufrufe nie wieder zu sehen.
    expect(a.write).toBe(fremd);

    await a.write('note.md', 'Text');
    expect(fremdLog).toEqual(['note.md']);
    expect(a.inhalte.get('note.md')).toBe('Text');
    // Unsere Schicht läuft mangels Ausbau weiter mit, darf aber nichts mehr merken.
    expect(wp.istEigen('note.md', 'Text')).toBe(false);
  });

  it('eine erneut installierte Instanz weckt die stillgelegte Schicht nicht wieder', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    const darunter = a.write.bind(a);
    a.write = (pfad: string, text: string): Promise<void> => darunter(pfad, text);
    wp.uninstall();

    wp.install();
    a.sperren();
    const p = a.write('note.md', 'Text');
    // Zwei aktive Schichten hätten den Pfadzähler doppelt gehoben; nach dem
    // Abschluss fiele er nur einmal und der Pfad bliebe für immer „eigen".
    a.freigeben();
    await p;

    expect(wp.istEigen('note.md', 'Von aussen geliefert')).toBe(false);
  });
});

describe('WriteProvenance — Fallstrick 6: der Zähler fällt auch bei Fehlern', () => {
  it('senkt den Zähler bei synchronem Wurf', () => {
    const a = {
      write(_pfad: string, _text: string): Promise<void> {
        throw new Error('EPERM');
      },
      async process(_pfad: string, fn: (data: string) => string): Promise<string> {
        return fn('');
      },
      async append(_pfad: string, _text: string): Promise<void> {},
    };
    const wp = new WriteProvenance(a);
    wp.install();

    expect(() => a.write('note.md', 'Text')).toThrow('EPERM');

    // Ohne try/finally bliebe der Zähler auf 1 stehen und der Pfad wäre für den
    // Rest der Sitzung „eigen" — jede echte Fremdänderung würde verschluckt.
    expect(wp.istEigen('note.md', 'Von aussen geliefert')).toBe(false);
  });

  it('senkt den Zähler bei abgelehntem Promise', async () => {
    const a = {
      async write(_pfad: string, _text: string): Promise<void> {
        throw new Error('ENOSPC');
      },
      async process(_pfad: string, fn: (data: string) => string): Promise<string> {
        return fn('');
      },
      async append(_pfad: string, _text: string): Promise<void> {},
    };
    const wp = new WriteProvenance(a);
    wp.install();

    await expect(a.write('note.md', 'Text')).rejects.toThrow('ENOSPC');

    expect(wp.istEigen('note.md', 'Von aussen geliefert')).toBe(false);
  });
});

describe('WriteProvenance — Fallstrick 7: Länge im Schlüssel', () => {
  // Konkretes Paar aus einer Geburtstagssuche über den 32-Bit-Hash (2026-08-04):
  // gleicher Hash, verschiedene Länge.
  const KURZ = 'shavbbksc'; // 9 Zeichen
  const LANG = 'ajtbjiizuo'; // 10 Zeichen

  it('trennt zwei Texte, deren 32-Bit-Hash kollidiert', () => {
    // Der Hash-Teil ist identisch — nur die Länge im Schlüssel trennt die beiden.
    expect(textSchluessel(KURZ).split(':')[1]).toBe(textSchluessel(LANG).split(':')[1]);
    expect(textSchluessel(KURZ)).not.toBe(textSchluessel(LANG));
  });

  it('stuft den kollidierenden Fremdtext nicht als eigen ein', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();

    await a.write('note.md', KURZ);

    expect(wp.istEigen('note.md', KURZ)).toBe(true);
    expect(wp.istEigen('note.md', LANG)).toBe(false);
  });

  it('zwei verschiedene Texte gleicher Länge kollidieren nicht', () => {
    const x = 'Zeile A\nZeile B';
    const y = 'Zeile B\nZeile A';

    expect(x.length).toBe(y.length);
    expect(textSchluessel(x)).not.toBe(textSchluessel(y));
  });
});

describe('WriteProvenance — Spurpflege', () => {
  it('renameNote zieht die Spur auf den neuen Pfad', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    await a.write('alt.md', 'Inhalt');

    wp.renameNote('alt.md', 'neu.md');

    expect(wp.istEigen('neu.md', 'Inhalt')).toBe(true);
    expect(wp.istEigen('alt.md', 'Inhalt')).toBe(false);
  });

  it('renameNote auf einem unbekannten Pfad überschreibt das Ziel nicht', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    await a.write('neu.md', 'Inhalt');

    wp.renameNote('nie-geschrieben.md', 'neu.md');

    expect(wp.istEigen('neu.md', 'Inhalt')).toBe(true);
  });

  it('forget räumt die Spur eines Pfades', async () => {
    const a = adapterMock();
    const wp = new WriteProvenance(a);
    wp.install();
    await a.write('note.md', 'Inhalt');
    await a.write('andere.md', 'Anderes');

    wp.forget('note.md');

    expect(wp.istEigen('note.md', 'Inhalt')).toBe(false);
    expect(wp.istEigen('andere.md', 'Anderes')).toBe(true);
  });
});
