import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { unionMerge, threeWayMerge } from '../src/text-merge';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// Task 18 / Teil 1 — MINIMALE REPROS der Diagnose „wo entsteht das Duplikat beim
// Erstkontakt zweier Geräte".
//
// Messgrundlage: der deterministische Fuzzer `zzdet.spec.ts` (40 Seeds je Modus)
// mit einem Detektor, der jeden Textzuwachs auf die erzeugende Codestelle
// zurückführt („ein Token steht im Ergebnis öfter als in JEDER Eingabe"). Befund
// im Modus `noMdConflict` (Datei-Konflikte ausgeschlossen, also der reine
// CRDT-Pfad): 23/40 Läufe mit Verdopplung, **23/40 davon geboren in
// `mergeCompatible` → `CrdtManager.applyUpdate`**, 0 in `unionMerge`, 0 in
// `threeWayMerge`, 0 ohne zuordenbare Geburtsstelle.
//
// Das widerlegt beide Vermutungen, mit denen dieser Task gestartet ist: Weder
// vereinigt `unionMerge` zu viel, noch konkateniert `switchToGuid` zwei
// Historien. Konkateniert wird in `mergeCompatible` — und zwar zwei Op-Ketten,
// die dieselbe GUID tragen, weil beide Geräte denselben Text unabhängig
// voneinander als EIGENE Yjs-Op materialisiert haben, bevor der Tie-Break die
// Inkarnationen vereinigt hat.
//
// Die Tests hier halten jede geprüfte Quelle einzeln fest — die tragende ebenso
// wie die vier, die sich als NICHT ursächlich erwiesen haben. Sie beschreiben
// den Ist-Zustand; wo sie eine Grenze festhalten statt eines Fehlers, steht das
// im Test.

const NOTE = 'note.md';
const A_YJS = '.qollab/note.md.aaaa1111.yjs';
const B_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_KLEIN = '00000000000000000000000000000000'; // gewinnt den Tie-Break
const G_GROSS = 'ffffffffffffffffffffffffffffffff'; // verliert

// Sidecar mit GUID-Header und dem State eines Docs mit `text`. Jeder Aufruf nutzt
// einen EIGENEN CrdtManager und damit eine eigene Yjs-clientID — genau das
// modelliert „zwei Geräte haben denselben Text unabhängig getippt".
function schreibeSidecar(vault: any, path: string, guid: string, text: string): void {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  vault._files.set(path, toAB(encodeStateFile(guid, m.encodeState(NOTE))));
}

const kopiere = (von: any, nach: any, path: string): void => {
  nach._files.set(path, von._files.get(path)!.slice(0));
};

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

describe('Task 18 / Q1+Q2 — die tragende Quelle: zwei Op-Ketten unter einer GUID', () => {
  // Der Ablauf ist Zeile für Zeile der Trace aus dem Fuzzer (Seed 4, Modus
  // noMdConflict), nur ohne Zufall: A trägt SEED, B nicht; der Datei-Sync liefert
  // die `.md` VOR der frischen Sidecar (der von der Recherche belegte Regelfall).
  it('Erstkontakt: SEED steht am Ende zweimal — geboren in mergeCompatible', async () => {
    const vaultA = makeVaultMock() as any;
    const vaultB = makeVaultMock() as any;

    // Ausgangslage: zwei unabhängig geprägte Inkarnationen desselben Textes.
    // B gewinnt den Tie-Break (kleinere GUID), A trägt zusätzlich SEED.
    schreibeSidecar(vaultA, A_YJS, G_GROSS, 'L1\nSEED\n');
    schreibeSidecar(vaultB, B_YJS, G_KLEIN, 'L1\n');
    vaultA._textFiles.set(NOTE, 'L1\nSEED\n');
    vaultB._textFiles.set(NOTE, 'L1\n');

    const handlerA = new SyncHandler(vaultA, new CrdtManager(), 'aaaa1111');
    const handlerB = new SyncHandler(vaultB, new CrdtManager(), 'bbbb2222');

    // Der Stand von B, wie ihn der Datei-Sync bei A ABLEGT — er wird gleich
    // veraltet sein, weil B unten weiterschreibt. Genau diese Verzögerung ist die
    // Vorbedingung: der Gewinner-Doc, den A aufbaut, kennt SEED noch nicht.
    const bVeraltet = vaultB._files.get(B_YJS)!.slice(0);

    // (1) Der Datei-Sync liefert A's `.md` und A's Sidecar zu B.
    vaultB._textFiles.set(NOTE, 'L1\nSEED\n');
    kopiere(vaultA, vaultB, A_YJS);
    await handlerB.applyLocalContent(NOTE, 'L1\nSEED\n');

    // B hat SEED als EIGENE Op eingefügt, obwohl A's Sidecar mit exakt diesem Text
    // daneben liegt: `mergeCompatible` überspringt sie, weil ihre GUID (G_GROSS)
    // nicht die eigene ist. Der Fremd-Stand ist für den lokalen Diff unsichtbar
    // und wird als lokale Änderung verbucht — Quelle Q1 (`sync-handler.ts:931`).
    expect(await handlerB.currentGuid(NOTE)).toBe(G_KLEIN);

    // (2) Der Datei-Sync liefert B's (noch alte) Sidecar zu A. A verliert den
    // Tie-Break und wechselt.
    vaultA._files.set(B_YJS, bVeraltet);
    await handlerA.loadAndMerge(NOTE);
    expect(await handlerA.currentGuid(NOTE)).toBe(G_KLEIN);

    // A hat seine Historie verworfen und den lokalen Überschuss (SEED) als FRISCHE
    // eigene Op wieder eingebracht — Quelle Q2 (`sync-handler.ts:829`, dokumentiert
    // als „der lokale Beitrag zählt danach als frische Einfügung dieses Geräts").
    // Für sich genommen korrekt: ohne sie wäre SEED verloren.

    // (3) Beide tragen jetzt G_KLEIN, aber je eine eigene Op-Kette für SEED. Der
    // Sync bringt sie zusammen — und Yjs dedupliziert nach Item-ID, nicht nach
    // Inhalt.
    kopiere(vaultA, vaultB, A_YJS);
    const merged = (await handlerB.loadAndMerge(NOTE))!;

    expect(zaehle(merged, 'SEED')).toBe(2);
    expect(zaehle(merged, 'L1')).toBe(1); // der gemeinsame Bestand bleibt einfach
  });

  // Gegenprobe zur selben Lage: sind beide Stände im Moment des Wechsels
  // byte-identisch, entsteht KEIN Duplikat. Das ist die Hälfte der Fälle, in denen
  // der Fuzzer sauber durchläuft (17/40 in `noMdConflict`) — und exakt die Lage,
  // die das Hash-Gate aus Teil 2 abfängt.
  it('Gegenprobe: byte-identische Stände beim Wechsel erzeugen kein Duplikat', async () => {
    const vaultA = makeVaultMock() as any;
    const vaultB = makeVaultMock() as any;
    schreibeSidecar(vaultA, A_YJS, G_GROSS, 'L1\nSEED\n');
    schreibeSidecar(vaultB, B_YJS, G_KLEIN, 'L1\nSEED\n');
    vaultA._textFiles.set(NOTE, 'L1\nSEED\n');
    vaultB._textFiles.set(NOTE, 'L1\nSEED\n');

    const handlerA = new SyncHandler(vaultA, new CrdtManager(), 'aaaa1111');
    const handlerB = new SyncHandler(vaultB, new CrdtManager(), 'bbbb2222');

    kopiere(vaultB, vaultA, B_YJS);
    await handlerA.loadAndMerge(NOTE);
    kopiere(vaultA, vaultB, A_YJS);
    const merged = (await handlerB.loadAndMerge(NOTE))!;

    expect(zaehle(merged, 'SEED')).toBe(1);
    expect(merged).toBe('L1\nSEED\n');
  });
});

describe('Task 18 / Teil 1 — geprüfte Kandidaten, die NICHT die Quelle sind', () => {
  // K1 (Brief): „unionMerge bei umsortierten Zeilen". Die Verdopplung existiert
  // und ist dokumentiert (text-merge.test.ts) — im Fuzz ist sie aber in 120 Läufen
  // (3 Modi × 40 Seeds) KEIN einziges Mal die Geburtsstelle gewesen. Grund: der
  // Fuzzer sortiert Zeilen nie um, er fügt ein und ändert Zeilen.
  it('K1: umsortierte Zeilen verdoppeln — aber nur bei echter Umsortierung', () => {
    expect(unionMerge('kopf\nA\nB\nfuss\n', 'kopf\nB\nA\nfuss\n')).toBe('kopf\nA\nB\nA\nfuss\n');
    // Einfügen an beliebiger Stelle — der Fuzz-Fall — verdoppelt nicht.
    expect(unionMerge('kopf\nA\nfuss\n', 'kopf\nA\nB\nfuss\n')).toBe('kopf\nA\nB\nfuss\n');
    expect(unionMerge('kopf\nA\nfuss\n', 'B\nkopf\nA\nfuss\n')).toBe('B\nkopf\nA\nfuss\n');
  });

  // K2 (Brief): „unionMerge bei einseitig gelöschten Zeilen". Die Zeile kommt
  // zurück (dokumentierte Richtung: Wiederauferstehung statt stillem Verlust) —
  // sie steht danach aber EINMAL da, nicht zweimal. Eine Wiederauferstehung ist
  // per Konstruktion keine Verdopplung.
  it('K2: einseitig gelöschte Zeile kehrt zurück — einfach, nicht doppelt', () => {
    const res = unionMerge('a\nb\nc\n', 'a\nc\n');
    expect(res).toBe('a\nb\nc\n');
    expect(zaehle(res, 'b')).toBe(1);
  });

  // K3 (Brief): „der Adopt-Zweig in ensureDoc — dort wird die Historie nicht
  // verworfen". Geprüft: ohne eigenen State adoptiert ensureDoc die fremde
  // Inkarnation und vereinigt die lokale `.md` hinein. Der adoptierte Fremd-Text
  // wird dabei NICHT ein zweites Mal materialisiert.
  it('K3: Adopt-Zweig vereinigt ohne zu verdoppeln', async () => {
    const vault = makeVaultMock() as any;
    schreibeSidecar(vault, A_YJS, G_KLEIN, 'gemeinsam\nfremd\n');
    vault._textFiles.set(NOTE, 'gemeinsam\nlokal\n');

    const handler = new SyncHandler(vault, new CrdtManager(), 'bbbb2222');
    const merged = (await handler.loadAndMerge(NOTE))!;

    expect(zaehle(merged, 'gemeinsam')).toBe(1);
    expect(zaehle(merged, 'fremd')).toBe(1);
    expect(zaehle(merged, 'lokal')).toBe(1);
  });

  // K4 (Brief): „kann die erste Vereinigung in switchToGuid (Zeile 802) Material
  // erzeugen, das die zweite (829-832) ein weiteres Mal einbringt?" Nein:
  // `unionMerge` ist gegen das eigene Ergebnis idempotent — jede Seite ist eine
  // Teilfolge der Vereinigung, also findet der zweite Zeilen-Diff nichts Neues.
  it('K4: die doppelte Vereinigung in switchToGuid ist idempotent', () => {
    const docText = 'kopf\nausDoc\n';
    const mdText = 'kopf\nausMd\n';
    const lokal = unionMerge(docText, mdText); // Zeile 802
    const gewinner = 'kopf\nvomGewinner\n';
    const einmal = unionMerge(gewinner, lokal); // Zeile 831
    expect(zaehle(einmal, 'ausDoc')).toBe(1);
    expect(zaehle(einmal, 'ausMd')).toBe(1);
    // Zweite Anwendung ändert nichts mehr.
    expect(unionMerge(gewinner, einmal)).toBe(einmal);
    expect(unionMerge(einmal, lokal)).toBe(einmal);
  });

  // K5 (Brief): „mehrfache Wechsel — wenn ein Gerät nacheinander auf verschiedene
  // Gewinner-GUIDs wechselt." Geprüft mit zwei aufeinanderfolgenden Wechseln
  // (G_GROSS → G_MITTE → G_KLEIN). Jeder Wechsel bringt den lokalen Stand genau
  // einmal ein; die Kette addiert keine zusätzliche Kopie.
  it('K5: zwei aufeinanderfolgende Inkarnationswechsel verdoppeln nichts', async () => {
    const G_MITTE = '88888888888888888888888888888888';
    const C_YJS = '.qollab/note.md.cccc3333.yjs';
    const vault = makeVaultMock() as any;

    schreibeSidecar(vault, A_YJS, G_GROSS, 'kopf\nlokal\n');
    schreibeSidecar(vault, B_YJS, G_MITTE, 'kopf\nvonB\n');
    vault._textFiles.set(NOTE, 'kopf\nlokal\n');

    const handler = new SyncHandler(vault, new CrdtManager(), 'aaaa1111');
    const nach1 = (await handler.loadAndMerge(NOTE))!;
    expect(await handler.currentGuid(NOTE)).toBe(G_MITTE);

    // Zweiter Wechsel: eine noch kleinere GUID taucht auf.
    schreibeSidecar(vault, C_YJS, G_KLEIN, 'kopf\nvonC\n');
    vault._textFiles.set(NOTE, nach1);
    const nach2 = (await handler.loadAndMerge(NOTE))!;
    expect(await handler.currentGuid(NOTE)).toBe(G_KLEIN);

    for (const marke of ['kopf', 'lokal', 'vonB', 'vonC']) {
      expect(zaehle(nach2, marke)).toBe(1);
    }
  });

  // K6 (Brief): „greift im Frontmatter-Fall etwas anderes als im Fließtext-Fall?"
  // Nein — dieselbe Mechanik. Der doppelte `status:`-Schlüssel hat aber ZWEI
  // Ursachen, die im Fuzz beide messbar sind (10/20 Läufe): die Op-Konkatenation
  // wie oben UND die dokumentierte Union-Semantik. Letztere ist hier isoliert:
  // ändert eine Seite eine Zeile und die andere nicht, ist das ohne gemeinsamen
  // Vorfahren nicht von „gelöscht + eingefügt" zu unterscheiden — beide Fassungen
  // bleiben stehen. Für YAML heißt das ein doppelter Schlüssel.
  it('K6: Frontmatter — die Union hält beide Fassungen einer geänderten Zeile', () => {
    const res = unionMerge(
      '---\nstatus: draft\ntags:\n---\n',
      '---\nstatus: ongoing\ntags:\n---\n'
    );
    expect(zaehle(res, 'status:')).toBe(2);
    expect(res).toContain('status: draft');
    expect(res).toContain('status: ongoing');
  });
});

describe('Task 18 / Q3 — beidseitig vorhandene Einfügung wird nicht verdoppelt', () => {
  // BIS 2026-08-11 war das die umgekehrte Zusage, und sie dokumentierte einen
  // Mangel: Enthielt `local` eine Einfügung, die `other` bereits trug, fügte
  // `patch_apply` sie ein ZWEITES Mal ein (die WARNUNG in text-merge.ts). Nur
  // in den Modi mit Datei-Konflikten messbar (baseline 5/40, baselineRace 7/40),
  // in `noMdConflict` 0/40. `chooseLocalDiffBase` existiert genau dagegen — als
  // Heuristik, die nicht in jeder Lage greift.
  //
  // Mit dem zeilenweisen 3-Wege-Merge entfällt der Mangel an der Wurzel: Beide
  // Seiten werden gegen die Basis aufgelöst, und wo beide dieselbe Zeile
  // hinzufügen, ist das EIN Beitrag, kein zweiter. Damit ist die Verdopplung
  // nicht mehr abzufangen, sondern schlicht ausgeschlossen.
  it('Q3: eine Einfügung, die beide Seiten schon tragen, steht genau einmal', () => {
    const basis = 'a\n';
    const lokal = 'a\nFREMD\n'; // die .md hat den Fremd-Edit bereits aufgeholt
    const anderer = 'a\nFREMD\n'; // der Doc auch
    const res = threeWayMerge(basis, lokal, anderer);
    expect(zaehle(res, 'FREMD')).toBe(1);
  });
});
