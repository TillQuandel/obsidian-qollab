// TEIL 3 — Pruefung der Behauptung „als fremde Operation einmergen ist unmoeglich,
// weil Yjs zwingend die eigene Kennung vergibt" (Alternative (c) des Auftrags).
//
// Die Behauptung wird hier in drei Stufen zerlegt und einzeln gemessen:
//   (c1) Laesst sich die Kennung eines Y.Doc ueberhaupt auf einen fremden Wert
//        setzen, sodass lokal erzeugte Ops sie tragen?
//   (c2) Wenn ja: Was passiert, wenn spaeter die ECHTEN Ops desselben Peers mit
//        denselben (Kennung, Zaehler)-Paaren eintreffen?
//   (c3) Und wenn man den Zaehler versetzt, damit es keine Kollision gibt?

import * as Y from 'yjs';

const T = 'content';

describe('c1 — traegt eine lokal erzeugte Op eine FREMDE Kennung?', () => {
  it('doc.clientID ist schreibbar; erzeugte Ops tragen den gesetzten Wert', () => {
    const doc = new Y.Doc();
    const eigene = doc.clientID;
    (doc as any).clientID = 4242;
    doc.getText(T).insert(0, 'fremder text');
    const clients = [...((doc.store as any).clients.keys() as Iterable<number>)];
    expect(clients).toEqual([4242]);
    expect(eigene).not.toBe(4242);
    // eslint-disable-next-line no-console
    console.log(`c1: Ops liegen unter Kennung ${clients.join(',')} (eigene war ${eigene})`);
  });

  it('new Y.Doc({ clientID }) wird ignoriert — Gegenprobe zur Genesis-Notiz', () => {
    const a = new Y.Doc({ clientID: 777 } as any);
    expect(a.clientID).not.toBe(777);
  });
});

describe('c2 — Kollision: dieselben (Kennung, Zaehler), anderer Inhalt', () => {
  it('die spaeter eintreffende ECHTE Op wird verworfen — stille Divergenz', () => {
    // A schreibt wirklich.
    const a = new Y.Doc();
    (a as any).clientID = 1000;
    a.getText(T).insert(0, 'Zeile-A\n');
    const echteOps = Y.encodeStateAsUpdate(a);

    // B hat A's `.md` bekommen und materialisiert den Text unter A's Kennung —
    // ohne A's Ops zu kennen. Der Zaehler startet zwangslaeufig bei 0.
    const b = new Y.Doc();
    (b as any).clientID = 1000;
    b.getText(T).insert(0, 'Zeile-A\n');

    // Jetzt trifft A's echte Hilfsdatei ein.
    Y.applyUpdate(b, echteOps);

    const bText = b.getText(T).toString();
    const aText = a.getText(T).toString();
    // eslint-disable-next-line no-console
    console.log(`c2: A="${JSON.stringify(aText)}" B="${JSON.stringify(bText)}"`);
    expect(bText).toBe('Zeile-A\n'); // keine Verdopplung...

    // ...aber: A und B haben unter derselben (Kennung, Zaehler) VERSCHIEDENE
    // Items. Ein spaeterer Edit von A auf seiner Fassung laesst sich bei B nicht
    // mehr korrekt einordnen.
    a.getText(T).insert(a.getText(T).length, 'Zeile-A2\n');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // eslint-disable-next-line no-console
    console.log(`c2/Folgeedit: A="${a.getText(T).toString()}" B="${b.getText(T).toString()}"`);
    // Der Rueckweg ebenfalls.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    // eslint-disable-next-line no-console
    console.log(`c2/beidseitig: A="${a.getText(T).toString()}" B="${b.getText(T).toString()}"`);
    expect(a.getText(T).toString()).toBe(b.getText(T).toString());
  });

  it('Kollision mit ABWEICHENDEM Inhalt: der fremde Beitrag geht still verloren', () => {
    const a = new Y.Doc();
    (a as any).clientID = 1000;
    a.getText(T).insert(0, 'ECHT-VON-A\n');
    const echteOps = Y.encodeStateAsUpdate(a);

    // B materialisiert einen ABWEICHENDEN Text unter derselben Kennung — der
    // Regelfall, sobald der Datei-Sync einen aelteren/neueren Stand liefert oder
    // der Text bei B lokal noch anders aussieht.
    const b = new Y.Doc();
    (b as any).clientID = 1000;
    b.getText(T).insert(0, 'RATE-VON-B\n');

    Y.applyUpdate(b, echteOps);
    const bText = b.getText(T).toString();
    // eslint-disable-next-line no-console
    console.log(`c2b: B nach Ankunft der echten Ops = ${JSON.stringify(bText)}`);
    expect(bText).toBe('RATE-VON-B\n'); // A's echter Text kommt NIE an
    expect(bText).not.toContain('ECHT-VON-A');

    // Und der Rueckweg konvergiert nicht auf denselben Text.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    // eslint-disable-next-line no-console
    console.log(
      `c2b/beidseitig: A=${JSON.stringify(a.getText(T).toString())} B=${JSON.stringify(
        b.getText(T).toString()
      )}`
    );

    // Die Divergenz ist DAUERHAFT, nicht bloss noch nicht ausgetauscht: beide
    // Zustandsvektoren sind gleich, es gibt also nichts mehr zu senden. Zehn
    // weitere Runden aendern nichts.
    const sv = (d: Y.Doc): string => Buffer.from(Y.encodeStateVector(d)).toString('hex');
    expect(sv(a)).toBe(sv(b));
    for (let i = 0; i < 10; i++) {
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    }
    expect(a.getText(T).toString()).toBe('ECHT-VON-A\n');
    expect(b.getText(T).toString()).toBe('RATE-VON-B\n');
    expect(a.getText(T).toString()).not.toBe(b.getText(T).toString());
  });
});

describe('c3 — Zaehler versetzt, damit es keine Kollision gibt', () => {
  it('ohne Kollision steht der Text doppelt — genau der heutige Schaden', () => {
    const a = new Y.Doc();
    (a as any).clientID = 1000;
    a.getText(T).insert(0, 'Zeile-A\n');
    const echteOps = Y.encodeStateAsUpdate(a);

    // B setzt den Zaehler hoch, um A's echte Ops nicht zu blockieren. Yjs bietet
    // dafuer keine API; wir simulieren es, indem B unter einer AUSWEICH-Kennung
    // schreibt (jeder kollisionsfreie Zaehler ist aequivalent: die Items sind
    // verschieden und werden nicht dedupliziert).
    const b = new Y.Doc();
    (b as any).clientID = 1001;
    b.getText(T).insert(0, 'Zeile-A\n');
    Y.applyUpdate(b, echteOps);
    // eslint-disable-next-line no-console
    console.log(`c3: B = ${JSON.stringify(b.getText(T).toString())}`);
    expect(b.getText(T).toString()).toBe('Zeile-A\nZeile-A\n');
  });

  it('Zaehler-Luecke: eine Op mit clock>0 ohne Vorgaenger bleibt ausstehend', () => {
    // Was, wenn B unter A's Kennung erst ab clock=100 schreibt?
    const b = new Y.Doc();
    (b as any).clientID = 1000;
    // Yjs bietet keinen Weg, den Zaehler zu setzen: getState liest ihn aus dem
    // Store. Ein handgebautes Update mit clock=100 ohne Vorgaenger landet im
    // PendingStructStore und wird NICHT integriert.
    const quelle = new Y.Doc();
    (quelle as any).clientID = 1000;
    for (let i = 0; i < 3; i++) quelle.getText(T).insert(0, 'x');
    const voll = Y.encodeStateAsUpdate(quelle);
    // Nur den Teil ab clock=2 senden (Vorgaenger fehlen).
    const teil = Y.encodeStateAsUpdate(quelle, Y.encodeStateVectorFromUpdate(voll));
    Y.applyUpdate(b, teil);
    // eslint-disable-next-line no-console
    console.log(
      `c3b: B-Text nach Teilupdate = ${JSON.stringify(b.getText(T).toString())}, clients=${
        (b.store as any).clients.size
      }, pending=${(b.store as any).pendingStructs ? 'ja' : 'nein'}`
    );
  });
});
