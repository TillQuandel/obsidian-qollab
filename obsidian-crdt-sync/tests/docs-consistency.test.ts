// Task 17 / F-7 — Drei falsche Zusagen in der Dokumentation, als Netz gepinnt
//
// Die README ist das einzige Artefakt, das die Nicht-Technikerin liest; eine
// falsche Zusage dort ist ein Fund wie jeder andere. Alle drei sind über die
// Jahre entstanden, weil nichts sie gegen den Code hält. Genau das tut dieser
// Test: er prüft die Aussagen gegen Konstanten und Funktionen aus `src/`, nicht
// gegen eine zweite Textkopie.

import { readFileSync } from 'fs';
import { join } from 'path';
import { SCAN_INTERVAL_MS } from '../src/sidecar-watcher';
import { filterYjsFiles, SyncHandler, QOLLAB_DIR } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { DEFAULT_SETTINGS } from '../src/settings';
import { encodeStateFile, decodeStateFile, StateFileIntegrityError } from '../src/state-file';
import { readSidecar, type SidecarAdapter } from '../src/sidecar-io';
import CrdtSyncPlugin, { FOREIGN_OWN_SIDECAR_NOTICE } from '../src/main';
import {
  makeVaultMock,
  makeLocalStorage,
  toArrayBuffer,
  type VaultMock,
} from './helpers/vault-mock';

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8');

// Das AUSGELIEFERTE Manifest, nicht eine Kopie davon. Was hier steht, entscheidet
// darueber, ob Obsidian das Plugin auf einem Handy ueberhaupt laedt.
const MANIFEST = JSON.parse(readFileSync(join(__dirname, '..', '..', 'manifest.json'), 'utf8')) as {
  isDesktopOnly?: boolean;
};

// Blockzitate tragen die „Richtigstellung"-Absätze, die frühere Zusagen wörtlich
// zitieren, um sie zu widerrufen. Ein Zitat in einem Widerruf ist keine Zusage —
// geprüft wird deshalb nur der Fließtext.
const CLAIMS = README.split('\n')
  .filter((line) => !line.trimStart().startsWith('>'))
  .join('\n');

describe('F-7: README hält, was der Code tut', () => {
  it('nennt das Poll-Intervall statt „sofort"', () => {
    // `sidecar-watcher.ts` pollt alle 30 s; sofort ist nur der Trigger beim
    // Öffnen einer Note. Wer „sofort" liest, hält das Plugin für defekt und
    // editiert von Hand — und landet damit im Merge-Fenster.
    expect(SCAN_INTERVAL_MS).toBe(30_000);
    expect(CLAIMS).not.toMatch(/Qollab (detects|picks) (this|that|it up) (instantly|immediately)/i);
    expect(CLAIMS).toMatch(/half a minute|30 seconds/);
  });

  it('nennt als Beispiel-Hilfsdatei eine Form, die der Sidecar-Filter akzeptiert', () => {
    // Bis Task 17 stand dort `note.md.yjs` — die v0.1-Form ohne clientId-Segment.
    // Wer danach sucht, findet nichts.
    // Nur konkrete Beispielnamen: Platzhalter (`<clientId>`), Globs (`*.yjs`) und
    // die blanke Endung sind keine Pfadangaben.
    const examples = [...CLAIMS.matchAll(/`([^`]*\.yjs)`/g)]
      .map((m) => m[1])
      .filter((e) => e.includes('.md.') && !e.includes('*') && !e.includes('<'));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const file = example.startsWith('.qollab/') ? example : `.qollab/${example}`;
      const notePath = file.slice('.qollab/'.length).replace(/\.[0-9a-f]{8}\.yjs$/, '');
      expect(filterYjsFiles([file], notePath)).toEqual([file]);
      // Und: keine Legacy-Form ohne clientId-Segment mehr als Beispiel.
      expect(file).toMatch(/\.[0-9a-f]{8}\.yjs$/);
    }
  });

  it('empfiehlt `.obsidian/` nicht mehr pauschal zum Mitsynchronisieren', () => {
    expect(CLAIMS).not.toMatch(/`\.obsidian\/` eingeschlossen/);
    // Stattdessen eine Ausschlussliste — die Dateien, für die im Zielvault reale
    // Konfliktkopien bzw. Secrets belegt sind.
    for (const excluded of ['workspace', 'vault-stats', 'graph.json', 'data.json']) {
      expect(CLAIMS).toContain(excluded);
    }
  });
});

// Szenariosuche Runde 2, Funde 38/39 — beides sind Zusagen, die die Architektur
// nicht hält. Der Schaden ist in `profile-loss.test.ts` reproduziert und dort als
// nicht behebbar belegt; die Korrektur konnte deshalb nur im README liegen.
describe('Funde 38/39: README hält, was das Geräteprofil hergibt', () => {
  it('nennt den Aus-Schalter als gerätelokal und nach Profilverlust zurückgesetzt', () => {
    // Der Schalter lebt ausschließlich im Geräteprofil (main.ts,
    // DEVICE_SETTINGS_KEY), und sein Default ist `true`. Jedes Gerät ohne dieses
    // Profil — Erststart wie Profilverlust — kommt damit scharf hoch. Weil der
    // README das Abschalten für große Vaults ausdrücklich empfiehlt, ist das
    // Verschweigen dieses Rücksetzers eine falsche Zusage.
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
    expect(CLAIMS).toContain("the honest advice is: don't enable it");
    expect(CLAIMS).toContain('sync toggle and deletion markers live outside the vault');
    expect(CLAIMS).toContain('starts with sync **enabled** again');
  });

  it('sagt den Zombie-Schutz nicht mehr vorbehaltlos zu', () => {
    // `enabled` und `tombstones` sind genau die beiden Felder, die `saveSettings`
    // aus `data.json` heraushält (Task 17/F-3) — sie leben nur im Geräteprofil.
    // Damit hängt der Zombie-Schutz an zwei Bedingungen: Qollab war beim Löschen
    // an, und das Profil lebt noch. Ein „behoben." ohne Vorbehalt ist falsch.
    expect(DEFAULT_SETTINGS).toHaveProperty('tombstones', {});
    expect(CLAIMS).not.toMatch(/\*\*A deleted note coming back — fixed\.\*\*/);
    expect(CLAIMS).toContain('A deleted note coming back — fixed, with two exceptions.');
    // Und beide Ausnahmen müssen im Fließtext benannt sein.
    expect(CLAIMS).toContain('was **switched off** on this device at the moment of the deletion');
    expect(CLAIMS).toContain('the **device profile is lost**');
  });
});

// Szenariosuche Runde 2, Fund 40 — eine verirrte Hilfsdatei kippt fremden Text in
// eine unbeteiligte Notiz. Der Schaden ist in `verirrte-sidecar.test.ts`
// reproduziert und dort als bewusste Grenze gepinnt; der README muss sie nennen,
// solange das Dateiformat den Note-Pfad nicht trägt.
describe('Fund 40: README nennt die Grenze, solange das Format keinen Pfad trägt', () => {
  it('sagt die Zuordnung über den Dateinamen zu — und der Code hält sie so', () => {
    // Code-Anker 1: Die gelesene Datei kennt genau zwei Felder. Kommt je ein
    // Note-Pfad dazu, ist die Grenze neu zu bewerten und dieser Test fällt.
    const datei = encodeStateFile('0'.repeat(32), new Uint8Array([0, 0]));
    expect(Object.keys(decodeStateFile(datei)).sort()).toEqual(['guid', 'update']);
    // Code-Anker 2: Die Zuordnung läuft rein über den Dateinamen — dieselben
    // Bytes gehören unter dem einen Namen zu der einen, unter dem anderen zu der
    // anderen Notiz.
    expect(filterYjsFiles(['.qollab/b.md.5e307e01.yjs'], 'b.md')).toHaveLength(1);
    expect(filterYjsFiles(['.qollab/b.md.5e307e01.yjs'], 'a.md')).toHaveLength(0);

    expect(CLAIMS).toContain('The filename is the only link between a helper file and its note');
    expect(CLAIMS).toContain("Don't reorganise `.qollab/` manually");
  });
});

// Der README verwies für die Datei-Explosion auf Issue #9 („Subdocuments +
// SQLite-Single-Store") und versprach damit eine Lösung, die nicht kommt: #9 ist
// als „not planned" geschlossen, beide Hälften sind widerlegt. Die Grenze selbst
// besteht unverändert — sie steckt in der Form des Sidecar-Pfads, und genau dort
// hängt dieser Test. Ändert sich die Ablage (flache Segmente je Gerät, #12),
// fällt er und die Aussage im README ist neu zu fassen.
describe('Datei-Explosion: README verspricht keine Lösung, die es nicht gibt', () => {
  const handler = (clientId: string) =>
    new SyncHandler({} as any, new CrdtManager(), clientId);

  it('nennt das Wachstum als offene Grenze — und der Code hält das Gesetz', () => {
    // Code-Anker: Der Pfad einer Hilfsdatei ist Funktion aus Note-Pfad UND
    // Geräte-ID, im unter `.qollab/` gespiegelten Baum. Daraus folgt unmittelbar
    // „Notes × Geräte" Dateien — das ist die Grenze, die der README benennt.
    const note = 'projekte/2026/notiz.md';
    const a = handler('a1b2c3d4').stateFilePath(note);
    const b = handler('e5f6a7b8').stateFilePath(note);
    expect(a).toBe(`${QOLLAB_DIR}/projekte/2026/notiz.md.a1b2c3d4.yjs`);
    expect(b).not.toBe(a);
    // Beide gehören zu derselben Notiz: zwei Geräte, zwei Dateien, eine Note.
    expect(filterYjsFiles([a, b], note)).toEqual([a, b]);
    // Und eine zweite Note bringt ihre eigenen mit — das Produkt, nicht die Summe.
    expect(filterYjsFiles([a, b], 'projekte/2026/andere.md')).toEqual([]);

    expect(CLAIMS).toContain('growing without bound');
    // Der Rat zum Deaktivieren steht ohne Bedingung, an die er geknüpft wäre.
    expect(CLAIMS).toContain("don't enable it, and that advice has no expiry date");
  });

  it('verweist nicht mehr auf das geschlossene Issue und seine widerlegte Lösung', () => {
    // Der tote Link ist im ganzen Dokument weg, auch in der Richtigstellung —
    // dort wird die Nummer nur noch genannt, nicht mehr verlinkt.
    expect(README).not.toMatch(/issues\/9(?!\d)/);
    // Und keine der beiden widerlegten Hälften wird im Fließtext noch zugesagt.
    expect(CLAIMS).not.toMatch(/SQLite/i);
    // „Subdocuments" darf im Fließtext stehen — aber nur im Widerruf. Der Absatz,
    // der das Wort führt, muss die Rücknahme UND ihre Begründung tragen; ein
    // zweiter Absatz mit dem Wort wäre wieder eine Zusage und fällt hier durch.
    // Absatzweise statt zeilenweise: die README hält einen Absatz pro Zeile, ein
    // Reflow soll den Wächter nicht kippen.
    const subdoc = CLAIMS.split(/\n\s*\n/).filter((p) => /subdocument/i.test(p));
    expect(subdoc).toHaveLength(1);
    expect(subdoc[0]).toMatch(/withdrawn and closed as \*not planned\*/);
    expect(subdoc[0]).toMatch(/subdocuments do not reduce the file count/i);
  });

  it('nennt die verfolgte Richtung als Arbeit, nicht als Zusage', () => {
    expect(CLAIMS).toContain('issues/12');
    expect(CLAIMS).toContain('no date and no promise');
    expect(CLAIMS).toContain('none of it is built');
  });
});

// Szenariosuche Runde 2, Fund 37 — die Meldung über eine fremd geschriebene
// eigene Hilfsdatei nannte eine Ursache, die an ihrer Stelle nicht feststeht,
// und der README bestätigte sie („nur noch möglich, wenn beide dieselbe alte
// `data.json` geerbt haben"). Der Schaden ist in `backup-restore.test.ts`
// reproduziert und dort als an der Erkennungsstelle nicht auflösbar belegt; die
// Korrektur konnte deshalb nur im Wortlaut liegen — und der muss in Meldung und
// README derselbe bleiben.
describe('Fund 37: README hält, was die Meldung wirklich sagt', () => {
  it('die Meldung behauptet keine Ursache, sondern nennt beide', () => {
    expect(FOREIGN_OWN_SIDECAR_NOTICE).not.toMatch(/Kollision/);
    expect(FOREIGN_OWN_SIDECAR_NOTICE).toMatch(/von außen verändert/);
    // Beide Ursachen, in dieser Reihenfolge nicht festgelegt — nur beide da.
    expect(FOREIGN_OWN_SIDECAR_NOTICE).toMatch(/zweites Gerät/);
    expect(FOREIGN_OWN_SIDECAR_NOTICE).toMatch(/Sicherung/);
  });

  it('der README sagt die Meldung nicht mehr als Kollisions-Nachweis zu', () => {
    // Die widerrufene Zusage. Sie stand im Fließtext und wird dort nicht mehr
    // geduldet; im Blockzitat der Richtigstellung darf sie zitiert werden (die
    // CLAIMS-Filterung oben blendet Blockzitate aus).
    expect(CLAIMS).not.toMatch(/reports this collision once/i);
    // Und der Absatz benennt, was die Meldung nicht leisten kann, plus beide
    // Ursachen — dieselben zwei, die auch im Meldungstext stehen.
    expect(CLAIMS).toContain('the notice cannot say which one it is');
    expect(CLAIMS).toContain('the same device ID');
    expect(CLAIMS).toContain('a backup of the `.qollab` folder was restored');
  });
});

// QLB2 — bis zu diesem Format sagte der README „no integrity check … This is not
// yet fixed.", und das stimmte. Jetzt stimmt es nicht mehr, und eine stehen
// gebliebene Einschraenkung ist genauso eine falsche Zusage wie eine zu grosse:
// Wer liest, sein Grundtext koenne still zerstoert werden, schaltet ab.
// Gehalten wird beides am FORMAT, nicht an einer zweiten Textkopie — faellt der
// Nachweis je weg, faellt dieser Block, und der README ist neu zu fassen.
describe('QLB2: README hält, was der Nachweis leistet — und was er kostet', () => {
  const GUID = '0'.repeat(32);
  // Ein Rumpf-Update. Inhalt egal — geprueft wird der Nachweis, nicht Yjs.
  const UPDATE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it('nennt den Nachweis — und das Format traegt ihn', () => {
    // Code-Anker: 24 Byte Kopf (4 Magic + 4 Hash + 16 GUID), der Hash deckt
    // GUID UND Update.
    const datei = encodeStateFile(GUID, UPDATE);
    expect(datei.length).toBe(24 + UPDATE.length);
    expect(decodeStateFile(datei).update).toEqual(UPDATE);

    // Der Schadensfall, den der README als gefangen ausweist: Nullfuellung bei
    // ERHALTENER Groesse, Nutzlast nur teilweise getroffen. Genau die Klasse,
    // die vorher fehlerfrei parste und den Grundtext still verfaelschte.
    const genullt = Uint8Array.from(datei);
    genullt.fill(0, 24 + 2);
    expect(genullt.length).toBe(datei.length);
    expect(() => decodeStateFile(genullt)).toThrow(StateFileIntegrityError);

    expect(CLAIMS).toContain('**Helper files carry a checksum.**');
    expect(CLAIMS).toContain('it is reported and skipped, and it is **never deleted**');
    // Und die widerrufene Einschraenkung steht nirgends mehr im Fliesstext.
    expect(CLAIMS).not.toMatch(/no integrity check/i);
  });

  it('nennt den Preis: abgeschnitten heisst gar nichts, Altformate bleiben ungeprueft', () => {
    const datei = encodeStateFile(GUID, UPDATE);
    // Code-Anker 1: abgeschnitten liefert keinen Teilstand, sondern einen Wurf —
    // unter wie ueber der Kopflaenge. Das ist der Preis, den der README nennt.
    expect(() => decodeStateFile(datei.subarray(0, datei.length - 3))).toThrow(
      StateFileIntegrityError
    );
    expect(() => decodeStateFile(datei.subarray(0, 20))).toThrow(StateFileIntegrityError);

    // Code-Anker 2: QLB1 (bis v0.4.0) und headerlose v0.1 werden weiter gelesen,
    // und zwar UNGEPRUEFT — ein Wurf hier waere der Datenverlust, den das Update
    // verhindern soll.
    const qlb1 = new Uint8Array(20 + UPDATE.length);
    qlb1.set([0x51, 0x4c, 0x42, 0x31], 0); // 'QLB1'
    qlb1.set(UPDATE, 20);
    expect(decodeStateFile(qlb1)).toEqual({ guid: '0'.repeat(32), update: UPDATE });
    expect(decodeStateFile(UPDATE)).toEqual({ guid: null, update: UPDATE });

    expect(CLAIMS).toContain('yields nothing at all instead of a partial state');
    expect(CLAIMS).toContain('Helper files written by older versions carry no checksum');
  });

  it('sagt die Mischflotten-Folge an, bevor jemand halb aktualisiert', () => {
    // Kein Code-Anker moeglich: der Schaden liegt im ausgelieferten v0.4.0-Code
    // (`tests/_v040/`), nicht in diesem. Gehalten wird deshalb der Wortlaut —
    // die Ansage darf nicht stillschweigend verschwinden, weil sie unbequem ist.
    expect(CLAIMS).toContain('**Update all your devices together.**');
    expect(CLAIMS).toContain('deletes them without a word');
    expect(CLAIMS).toContain('A half-updated vault therefore loses helper files');
  });
});

// Der README sagte bis zur englischen Fassung das GEGENTEIL des Codes: „For every
// note, Qollab keeps a small helper file". Der Sweep legt für eine unberührte
// Notiz gerade KEINE an (main.ts, Task 13/B: ohne eigene Sidecar nur dann
// snapshotten, wenn eine adoptierbare fremde vorliegt) — die Historie entsteht
// beim ersten echten Edit, genau einmal, auf dem Gerät das editiert hat. Die
// Folge für die Leserin ist der eigentliche Punkt: bis dahin schützt Qollab die
// Notiz nicht. Die Aussage stand unter keinem Wächter; genau deshalb konnte sie
// sich beim Übersetzen umdrehen.
describe('Lazy-Anlage: README hält, wann eine Hilfsdatei überhaupt entsteht', () => {
  function makePlugin(vault: VaultMock): CrdtSyncPlugin {
    const vaultWithEvents = Object.assign(vault, { on: () => ({}), offref: () => {} });
    const storage = makeLocalStorage();
    storage.saveLocalStorage('qollab-client-id', 'deadbeef');
    const app = {
      vault: vaultWithEvents,
      workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
      loadLocalStorage: storage.loadLocalStorage,
      saveLocalStorage: storage.saveLocalStorage,
    };
    return new CrdtSyncPlugin(app as any, {} as any);
  }

  it('unberührte Notiz bekommt keine, adoptierbare bekommt eine — und der README sagt beides', async () => {
    const vault = makeVaultMock();
    // A: nur die `.md`, nichts sonst. Niemand hat sie je editiert.
    vault._textFiles.set('unberuehrt.md', 'Inhalt\n');
    vault._mdMtimes.set('unberuehrt.md', 10);
    // B: dieselbe Lage, aber die Hilfsdatei eines anderen Geräts ist angekommen.
    vault._textFiles.set('fremd-gesehen.md', 'Inhalt\n');
    vault._mdMtimes.set('fremd-gesehen.md', 10);
    const mgr = new CrdtManager();
    mgr.setContent('fremd-gesehen.md', 'Inhalt\n');
    vault._files.set(
      '.qollab/fremd-gesehen.md.00000001.yjs',
      toArrayBuffer(encodeStateFile('a'.repeat(32), mgr.encodeState('fremd-gesehen.md')))
    );
    vault._mtimes.set('.qollab/fremd-gesehen.md.00000001.yjs', 5);

    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    // Code-Anker: der Sweep hat für A nichts angelegt — kein eigener, kein
    // fremder Pfad. Wird die Anlage je eifrig, fällt genau diese Zeile.
    expect(filterYjsFiles([...vault._files.keys()], 'unberuehrt.md')).toEqual([]);
    // Und für B sehr wohl: die fremde Historie wird adoptiert statt ignoriert.
    expect(filterYjsFiles([...vault._files.keys()], 'fremd-gesehen.md')).toContain(
      '.qollab/fremd-gesehen.md.deadbeef.yjs'
    );

    // Beide Hälften der Zusage, und die Folge, die der Leserin gehört.
    expect(CLAIMS).toContain('A note gets its helper file only once it is edited');
    expect(CLAIMS).toContain("or once another device's helper file for it arrives");
    expect(CLAIMS).toContain(
      '**until a note has been edited in Obsidian once, Qollab does not protect it.**'
    );
  });
});

// DER RUECKFALL DER `.md` — der zweite stille Verlustweg.
//
// Die deutsche README-Fassung (Commit `6a95170^`, Zeile 144) beschrieb ihn so:
// „Faellt die `.md` fremdbestimmt hinter den Merge-Zustand zurueck […] Der
// eigene, noch nicht synchronisierte Edit wird dabei als Loeschung in die eigene
// Hilfsdatei geschrieben, also gerade dort entfernt, wo er als letztes noch
// existierte." Die englische Fassung sagte an zwei Stellen das Gegenteil („never
// silently gone", „0 %") — ohne dass irgendein Test die Aussage hielt.
//
// Der Weg ist HALB zu. Im laufenden Betrieb greift DAS TOR (main.ts:326-334):
// eine `.md`, die dieser Prozess nicht geschrieben hat, wird geparkt statt
// gediffed. Der START-SWEEP hat dieses Tor nicht — main.ts sagt das selbst
// („beim Start ist Herkunft ohnehin nicht ableitbar"). Genau diese Asymmetrie
// pinnen die beiden Tests unten, JE MIT dem Gegenstueck: faellt eine der beiden
// Haelften, ist der README-Absatz neu zu fassen.
describe('Rueckfall der .md: README haelt, welche Haelfte des Wegs offen ist', () => {
  const BASIS = 'kopf\nzeile-1\nfuss\n';
  const MIT_EDIT = 'kopf\nzeile-1\nAAA\nfuss\n';
  const GUID = 'a'.repeat(32);

  // Vault-Lage: die eigene Hilfsdatei traegt den lokalen Edit, die `.md` auf der
  // Platte NICHT — und sie ist juenger. Das ist die Lage nach einem
  // Sync-Overwrite, einer Wiederherstellung aus dem Versionsverlauf oder einem
  // verkuerzten Lesevorgang.
  function baueLage(clientId: string): VaultMock {
    const vault = makeVaultMock();
    const mgr = new CrdtManager();
    mgr.setContent('note.md', MIT_EDIT);
    vault._files.set(
      `.qollab/note.md.${clientId}.yjs`,
      toArrayBuffer(encodeStateFile(GUID, mgr.encodeState('note.md')))
    );
    vault._mtimes.set(`.qollab/note.md.${clientId}.yjs`, 5);
    // Die `.md` ist zurueckgefallen — und traegt den JUENGEREN Zeitstempel, weil
    // der Sync-Dienst gerade eben geschrieben hat.
    vault._textFiles.set('note.md', BASIS);
    vault._mdMtimes.set('note.md', 99);
    return vault;
  }

  // Was steht am Ende in der eigenen Hilfsdatei? Nicht „was denkt der Doc" —
  // die DATEI ist das, was zum anderen Geraet faehrt.
  function inHilfsdatei(vault: VaultMock, clientId: string): string {
    const roh = vault._files.get(`.qollab/note.md.${clientId}.yjs`);
    if (!roh) return '<keine Hilfsdatei>';
    const mgr = new CrdtManager();
    mgr.applyUpdate('note.md', decodeStateFile(new Uint8Array(roh)).update);
    return mgr.getContent('note.md');
  }

  function makeApp(vault: VaultMock): {
    app: unknown;
    handlers: Map<string, (...args: any[]) => any>;
  } {
    const handlers = new Map<string, (...args: any[]) => any>();
    const vaultWithEvents = Object.assign(vault, {
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    });
    const storage = makeLocalStorage();
    storage.saveLocalStorage('qollab-client-id', 'deadbeef');
    return {
      app: {
        vault: vaultWithEvents,
        workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
        loadLocalStorage: storage.loadLocalStorage,
        saveLocalStorage: storage.saveLocalStorage,
      },
      handlers,
    };
  }

  it('START-SWEEP: der eigene Edit wird als Loeschung in die eigene Hilfsdatei geschrieben', async () => {
    const vault = baueLage('deadbeef');
    const { app } = makeApp(vault);
    const plugin = new (CrdtSyncPlugin as any)(app, {});
    await plugin.onload();
    expect(plugin.clientId).toBe('deadbeef');
    // Vorher steht der Edit in der Datei, die zum anderen Geraet faehrt.
    expect(inHilfsdatei(vault, 'deadbeef')).toBe(MIT_EDIT);

    await plugin.runStartupSweep();
    plugin.onunload();

    // CODE-ANKER: nachher nicht mehr. Der Sweep hat den `.md`-Rueckfall als
    // lokale Loeschung verbucht und sie in die eigene Hilfsdatei geschrieben —
    // genau dort, wo der Edit als letztes noch existierte. Faellt diese Zeile,
    // ist der Weg zu und der README-Absatz zu streichen.
    expect(inHilfsdatei(vault, 'deadbeef')).toBe(BASIS);

    // Und der README sagt es, statt „never silently gone" zu behaupten.
    expect(CLAIMS).toContain('**Obsidian was closed while your `.md` was overwritten**');
    expect(CLAIMS).toContain('the startup scan has no such signal');
  });

  it('LAUFENDER BETRIEB: dasselbe ueber den modify-Handler laesst den Edit stehen', async () => {
    const vault = baueLage('deadbeef');
    const { app, handlers } = makeApp(vault);
    const plugin = new (CrdtSyncPlugin as any)(app, {});
    await plugin.onload();
    expect(inHilfsdatei(vault, 'deadbeef')).toBe(MIT_EDIT);

    // Dasselbe Ereignis, nur mit laufender App: das Tor sieht, dass dieser
    // Prozess den Inhalt nicht geschrieben hat, und parkt statt zu erfassen.
    const modify = handlers.get('modify');
    expect(modify).toBeDefined();
    await modify!(tfileFuerNote(vault, 'note.md'));
    plugin.onunload();

    // CODE-ANKER (Gegenstueck): hier ueberlebt der Edit. Faellt DIESE Zeile,
    // ist der Weg breiter als der README sagt — dann ist er ebenfalls neu zu
    // fassen, nur in die andere Richtung.
    expect(inHilfsdatei(vault, 'deadbeef')).toBe(MIT_EDIT);

    // Der README schreibt dem Tor genau diese Reichweite zu: laufende App.
    expect(CLAIMS).toContain('While Obsidian is running, Qollab can tell');
  });
});

// DESKTOP-ONLY — das Manifest sagte `isDesktopOnly: false` und versprach damit
// ausdruecklich Mobile. Formal stimmte die Begruendung („es wird keine
// Desktop-only-API genutzt"), inhaltlich war sie irrefuehrend: Nicht abstuerzen
// ist keine Unterstuetzung. Gehalten wird die Zusage deshalb an zwei Stellen
// gleichzeitig — am AUSGELIEFERTEN Manifest und am Schalter, der die Begruendung
// traegt. Kippt jemand das Flag zurueck, ohne den README zu aendern, faellt der
// erste Test; bekommt Mobile je den Direktzugriff (oder laeuft die Adapter-Sicht
// nicht mehr nach), faellt der zweite — und dann ist der README neu zu fassen,
// diesmal in die andere Richtung.
describe('Desktop-only: Manifest und README sagen dasselbe', () => {
  // Ein Sidecar-Adapter, der mitzaehlt, ob `readSidecar` ihn ueberhaupt fragt.
  function adapterMitZaehler(basePath?: string): {
    adapter: SidecarAdapter;
    gefragt: () => number;
  } {
    let gefragt = 0;
    const nein = async (): Promise<never> => {
      throw new Error('in diesem Test nicht erwartet');
    };
    const adapter: SidecarAdapter = {
      exists: async () => {
        gefragt++;
        return false;
      },
      readBinary: async () => {
        gefragt++;
        return new ArrayBuffer(0);
      },
      writeBinary: nein,
      remove: nein,
      mkdir: nein,
      stat: nein,
      list: nein,
      rename: nein,
    };
    if (basePath !== undefined) adapter.getBasePath = () => basePath;
    return { adapter, gefragt: () => gefragt };
  }

  it('das Manifest steht auf desktop-only — und der README sagt es', () => {
    // Der Anker ist das echte Manifest, nicht eine zweite Textkopie: genau diese
    // Datei wird ausgeliefert und von Obsidian gelesen.
    expect(MANIFEST.isDesktopOnly).toBe(true);
    expect(CLAIMS).toContain('**Desktop only.**');
    expect(CLAIMS).toContain('does not load on Obsidian Mobile');
    // Und die Folge fuer die Leserin, die es heute auf einem Handy hat — sie
    // gehoert zur Aussage dazu, nicht in die Release-Notes allein.
    expect(CLAIMS).toContain('this version stops running there');
    // Die alte Zeile behauptete den falschen Grund: die Herkunftserkennung
    // haengt an `write`/`process`/`append`/`writeBinary`, die es auf Mobile
    // ebenso gibt. Sie darf nicht zurueckkehren.
    expect(CLAIMS).not.toMatch(/provenance detection largely does not work/i);
  });

  it('nennt den Grund, den der Code traegt: ohne `getBasePath` keine Direktlesung', async () => {
    const pfad = '.qollab/notiz.md.aaaa1111.yjs';

    // CODE-ANKER (Mobile-Zweig): Ohne `getBasePath` — der Fall auf dem
    // CapacitorAdapter — laeuft der Lesezugriff ueber den Adapter, also genau
    // die nachlaufende Sicht, die der README benennt.
    const mobil = adapterMitZaehler();
    expect(await readSidecar(mobil.adapter, pfad)).toBeNull();
    expect(mobil.gefragt()).toBeGreaterThan(0);

    // CODE-ANKER (Gegenstueck, Desktop): Mit `getBasePath` wird der Adapter GAR
    // NICHT gefragt — gelesen wird am Dateisystem. Der Basispfad zeigt bewusst
    // ins Leere; geprueft wird, WER gefragt wurde, nicht was zurueckkam.
    const desktop = adapterMitZaehler(join(__dirname, 'gibt-es-diesen-ordner-nicht'));
    expect(await readSidecar(desktop.adapter, pfad)).toBeNull();
    expect(desktop.gefragt()).toBe(0);

    expect(CLAIMS).toContain('exists only on the desktop adapter');
    expect(CLAIMS).toContain('falls back to precisely the lagging view');
  });
});

// Ein TFile, wie ihn der Vault-Index liefert — der modify-Handler prueft
// `instanceof TFile`, ein Objektliteral genuegt ihm nicht.
function tfileFuerNote(vault: VaultMock, pfad: string): unknown {
  return vault.getAbstractFileByPath(pfad);
}
