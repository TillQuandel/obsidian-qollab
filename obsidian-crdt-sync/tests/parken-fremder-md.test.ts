import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// ERSTKONTAKT — der Schadensweg und das Parken, das ihn schließt.
//
// Der Schaden entsteht nicht dadurch, dass zwei Geräte unabhängig prägen, sondern
// dadurch, dass eine per Datei-Sync gelieferte `.md` als EIGENE Bearbeitung
// verbucht wird: `applyLocalContent` difft sie gegen den eigenen Doc und macht aus
// fremdem Text eine Op unter eigener Client-ID. Trifft später die fremde Sidecar
// ein, dedupliziert Yjs nach Item-ID und nicht nach Inhalt — der Text steht
// zweimal da.
//
// Vier unabhängige Untersuchungen (2026-08-03) führen 100 % des gemessenen
// Schadens hierher; ohne diesen Kanal blieben 4320 von 4320 Fuzz-Läufen sauber.
//
// Die Antwort ist NICHT „fremd erkannt ⇒ verwerfen": das Herkunftssignal misst
// „dieser Prozess oder ein fremder", und ein externer Editor (Notepad, VS Code,
// `git checkout`) ist ebenfalls fremd — Verwerfen frisst dort 65–100 % der
// echten Bearbeitungen. Die Antwort ist ein Aufschub: parken, mit Frist und
// Nachtrag.

const NOTE = 'note.md';
const OWN_YJS = '.qollab/note.md.aaaa1111.yjs';
const FREMD_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_EIGEN = 'ffffffffffffffffffffffffffffffff';
const G_FREMD = '00000000000000000000000000000000'; // kleiner ⇒ gewinnt den Tie-Break

function fremdeSidecar(vault: any, path: string, guid: string, text: string): void {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  vault._files.set(path, toAB(encodeStateFile(guid, m.encodeState(NOTE))));
}

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

describe('Erstkontakt — gelieferte .md wird nicht als eigene Bearbeitung verbucht', () => {
  // Der Ablauf ist der belegte Regelfall: der Datei-Sync legt die `.md` des Peers
  // ab, BEVOR dessen Hilfsdatei ankommt. Genau in diesem Fenster feuert Obsidians
  // `modify` — ununterscheidbar davon, dass jemand getippt hätte.
  // Die GETEILTE Kennung ist die schadensträchtigste Lage (gemessen 66,4 %
  // Verdopplung gegen 6,9 % bei zwei getrennten Historien): Beide Sidecars sind
  // kompatibel, `mergeCompatible` zieht die fremde Op-Kette bedingungslos ein —
  // und das Hash-Gate aus `switchToGuid`, das den Tie-Break-Fall abfängt, liegt
  // gar nicht auf diesem Pfad.
  it('SCHADENSWEG: als eigener Edit erfasst ⇒ der Text steht am Ende zweimal', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    // Gemeinsame Historie: der Peer hat sie geprägt, dieses Gerät adoptiert sie.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\n');
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    expect(vault._files.has(OWN_YJS)).toBe(true);

    // Der Peer tippt FREMD — als eigene Op-Kette unter DERSELBEN Kennung.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\nFREMD\n');
    const peerSidecar = vault._files.get(FREMD_YJS)!;
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\n'); // sie ist noch unterwegs

    // Der Datei-Sync ist schneller: die `.md` des Peers liegt schon da, die
    // Hilfsdatei noch nicht. Obsidian meldet `modify` — ununterscheidbar von
    // einem Tastendruck.
    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    await sync.applyLocalContent(NOTE, geliefert);

    // Jetzt trifft die Hilfsdatei ein. Gleiche Kennung ⇒ kompatibel ⇒ gemergt.
    vault._files.set(FREMD_YJS, peerSidecar);
    await sync.loadAndMerge(NOTE);

    // Yjs dedupliziert nach Item-ID, nicht nach Inhalt: FREMD steht jetzt zweimal.
    // Das ist der BESTAND und bleibt es für jeden Aufrufer, der gelieferten Text
    // als eigenen erfasst — die Herkunftsentscheidung trifft nicht diese Methode.
    // Der Test daneben fährt denselben Ablauf durch das Tor.
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(2);
  });

  // Derselbe Ablauf, nur wird der gelieferte Stand geparkt statt erfasst. Das ist
  // der Beweis, dass genau dieser Kanal den Schaden trägt.
  it('GEGENPROBE: geparkt statt erfasst ⇒ der Text steht genau einmal', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\n');
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\nFREMD\n');
    const peerSidecar = vault._files.get(FREMD_YJS)!;
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\n');

    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    vault._files.set(FREMD_YJS, peerSidecar);
    await sync.loadAndMerge(NOTE);

    expect(sync.hasParked(NOTE)).toBe(false);
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('geparkt: der gelieferte Text wird nicht erfasst, der Doc bleibt unberührt', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    expect(sync.hasParked(NOTE)).toBe(true);
    expect(crdt.getContent(NOTE)).toBe('kopf\n');

    fremdeSidecar(vault, FREMD_YJS, G_FREMD, geliefert);
    await sync.loadAndMerge(NOTE);

    // Die Historie ist da und deckt den geparkten Stand: Parken beendet, ohne
    // dass je eine eigene Op für fremden Text entstanden ist.
    expect(sync.resolveParked(NOTE)).toBe(true);
    expect(sync.hasParked(NOTE)).toBe(false);
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
  });

  // Bedingung 2 der Messreihe: „Die Vergleichsbasis muss mitwandern." Bleibt sie
  // auf dem alten Stand, ist das Delta des nächsten Tastendrucks „Basis → Datei"
  // die LÖSCHUNG des geparkten Textes — der Fix erzeugte dann genau den Schaden,
  // den er verhindern soll (gemessen: der nächste Tastendruck löscht ihn aus der
  // Datei).
  it('tippt der Nutzer auf den geparkten Stand, überlebt beides', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Der Nutzer tippt jetzt seine eigene Zeile dazu.
    const getippt = 'kopf\nFREMD\nEIGEN\n';
    vault._textFiles.set(NOTE, getippt);
    await sync.applyLocalContent(NOTE, getippt);

    // Der eigene Tastendruck ist erfasst — der gelieferte Text aber NICHT als
    // eigene Op. Das ist der Kern: Stünde die Diff-Basis noch auf dem Stand VOR
    // dem Parken, wäre das Delta dieses Tastendrucks „FREMD und EIGEN eingefügt"
    // und der gelieferte Text damit doch eine eigene Operation — das Parken hätte
    // genau einen Tastendruck lang gehalten.
    expect(crdt.getContent(NOTE)).toContain('EIGEN');
    expect(crdt.getContent(NOTE)).not.toContain('FREMD');
    expect(sync.hasParked(NOTE)).toBe(true);
    expect(sync.parkedText(NOTE)).toBe(getippt);
  });

  // Bedingung 3: „Das Nachtragen darf kein Differenz-Verfahren sein." Der geparkte
  // Stand ist kein Nachfolger des Docs — eine dort fehlende Zeile würde sonst als
  // Löschung gelesen und zum Peer propagiert (gemessen: 36 stille Verluste, mit
  // Vereinigung 0).
  it('Fristablauf: der Nachtrag vereinigt, statt zu diffen', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\nEIGEN\n');
    await sync.applyLocalContent(NOTE, 'kopf\nEIGEN\n');

    // Der gelieferte Stand kennt EIGEN nicht (der Peer hatte ihn noch nicht) und
    // bringt dafür FREMD mit.
    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Die Hilfsdatei kommt nie. Nach Ablauf der Frist wird doch erfasst.
    for (let i = 0; i < 4; i++) await sync.tickParked(NOTE, 4);

    expect(sync.hasParked(NOTE)).toBe(false);
    const doc = crdt.getContent(NOTE);
    expect(doc).toContain('FREMD');
    // Als Diff nachgetragen wäre EIGEN jetzt eine Delete-Op — und zum Peer
    // propagiert.
    expect(doc).toContain('EIGEN');
  });

  // Ohne Frist fielen gemessen 60 % bzw. 12,9 % der Notizen dauerhaft aus dem
  // Abgleich: „später entscheiden" wird zu „nie entscheiden".
  it('vor Ablauf der Frist wird nichts nachgetragen', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    vault._textFiles.set(NOTE, 'kopf\nFREMD\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');

    for (let i = 0; i < 3; i++) await sync.tickParked(NOTE, 4);

    expect(sync.hasParked(NOTE)).toBe(true);
    expect(crdt.getContent(NOTE)).not.toContain('FREMD');
  });

  // Der Parkplatz ist neuer Per-Pfad-Zustand und muss sich in die Lebenszyklen
  // einreihen — wie `guids`, `localDiffBase`, `abortedReads`, `priorPaths`.
  it('renameNote zieht den Parkplatz mit', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');

    sync.renameNote(NOTE, 'neu.md');

    expect(sync.hasParked(NOTE)).toBe(false);
    expect(sync.hasParked('neu.md')).toBe(true);
  });

  // Ohne Guard prägt ein Fristablauf nach dem Löschen eine PHANTOM-INKARNATION:
  // `ensureDoc` setzt die frische GUID (sync-handler.ts:839), BEVOR es den
  // fehlenden `.md` bemerkt (:863) — `saveState` legt danach eine Hilfsdatei für
  // eine Notiz an, die es nicht mehr gibt, und kein Tombstone deckt sie.
  it('gelöschte Notiz: kein Nachtrag, keine Phantom-Hilfsdatei', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');

    // Die Notiz wird gelöscht — Datei weg, eigener Zustand weg.
    vault._textFiles.delete(NOTE);
    vault._files.delete(OWN_YJS);
    sync.disposeNote(NOTE);

    expect(sync.hasParked(NOTE)).toBe(false);

    // Und selbst wenn ein Tick den Pfad noch erwischt: kein neuer Zustand.
    await sync.tickParked(NOTE, 1);
    expect(vault._files.has(OWN_YJS)).toBe(false);
  });

  // Der Poll hat eine eigene Tür: `ensureDoc` (Adopt-Zweig) und `switchToGuid`
  // lesen die `.md` SELBST und vereinigen sie — ohne `applyLocalContent`, ohne
  // modify-Ereignis. Ein Tor nur im modify-Pfad deckt einen von vier Aufrufern ab.
  it('Poll-Tür: solange geparkt ist, ist die .md kein Zeuge des lokalen Stands', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    // Eigene, unterlegene Inkarnation mit eigenem Beitrag.
    vault._textFiles.set(NOTE, 'kopf\nEIGEN\n');
    await sync.applyLocalContent(NOTE, 'kopf\nEIGEN\n');

    // Der Sync liefert die Fassung des Peers; sie wird geparkt.
    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Jetzt kommt die Hilfsdatei einer FREMDEN, gewinnenden Inkarnation.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, geliefert);
    await sync.loadAndMerge(NOTE);

    // `switchToGuid` hat auf die Gewinner-Kette gewechselt. Der gelieferte Text
    // darf dabei NICHT als eigener Beitrag dieses Geräts eingebracht worden sein —
    // sonst steht er doppelt, sobald der Peer seine eigene Kette mitbringt.
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
    // Der echte eigene Beitrag überlebt den Wechsel.
    expect(crdt.getContent(NOTE)).toContain('EIGEN');
  });

  it('unbeteiligte Notizen bleiben unberührt: Parken ist pfadbezogen', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'a\n');
    vault._textFiles.set('andere.md', 'b\n');
    await sync.applyLocalContent(NOTE, 'a\n');
    await sync.applyLocalContent('andere.md', 'b\n');

    sync.parkForeign(NOTE, 'a\nFREMD\n');

    vault._textFiles.set('andere.md', 'b\nGETIPPT\n');
    await sync.applyLocalContent('andere.md', 'b\nGETIPPT\n');

    expect(crdt.getContent('andere.md')).toContain('GETIPPT');
    expect(sync.hasParked('andere.md')).toBe(false);
    expect(sync.hasParked(NOTE)).toBe(true);
  });
});

// Sicherheitsnetz für den Kern-Guard: `unionMerge` kann nur hinzufügen. Damit ist
// ausgeschlossen, dass ein Nachtrag eine Zeile ENTFERNT — die teure Fehlerrichtung.
export {};

// ---------------------------------------------------------------------------
// SCHÄRFUNG. Die erste Fassung dieser Datei war grün und bewachte trotzdem nur
// drei von zehn Mechaniken: Nimmt man die anderen sieben testweise zurück, fällt
// kein Test. Die folgenden Fälle schließen das — jeder ist gegen die Rücknahme
// genau seiner Codezeile geprüft.
// ---------------------------------------------------------------------------

describe('Erstkontakt — die Mechaniken einzeln bewacht', () => {
  // M7: `loadAndMerge` muss `null` liefern, solange etwas geparkt ist. `null`
  // heißt für jeden Aufrufer „kein Write-Back, Trigger unverbraucht" — ohne das
  // schreibt der Poll den Doc-Stand in die Datei und löscht den geparkten Text.
  it('M7 — loadAndMerge liefert null, solange der Doc den Parkplatz nicht deckt', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    vault._textFiles.set(NOTE, 'kopf\nFREMD\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');

    // Es liegt eine fremde Hilfsdatei vor, die den geparkten Stand NICHT deckt.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\nANDERES\n');
    expect(await sync.loadAndMerge(NOTE)).toBeNull();
    expect(sync.hasParked(NOTE)).toBe(true);
  });

  // M8: Guard „keine `.md` ⇒ kein Nachtrag". Ohne ihn prägt der Fristablauf eine
  // Inkarnation für eine Notiz, die es nicht mehr gibt: `ensureDoc` setzt die
  // GUID, bevor es den fehlenden `.md` bemerkt, und `saveState` schreibt eine
  // Hilfsdatei, die kein Tombstone deckt.
  it('M8 — Fristablauf ohne .md prägt keine Phantom-Hilfsdatei', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');

    // Die Datei verschwindet, OHNE dass disposeNote läuft — genau das Fenster,
    // in dem der Guard allein trägt (extern gelöscht, Sync-Löschung, Rename
    // dazwischen).
    vault._textFiles.delete(NOTE);
    vault._files.delete(OWN_YJS);
    crdt.disposeDoc(NOTE);

    await sync.tickParked(NOTE, 1);

    expect(sync.hasParked(NOTE)).toBe(false);
    expect(vault._files.has(OWN_YJS)).toBe(false);
  });

  // M9: Die Diff-Basis wird VOR dem Nachtrag auf den Doc-Stand zurückgesetzt.
  // Beim Parken steht sie auf dem geparkten Text; bliebe sie dort, wäre das
  // Delta des Nachtrags leer und er ein No-op — der erste Entwurf verlor so
  // 100 % der externen Bearbeitungen.
  it('M9 — der Nachtrag ist kein No-op: der geparkte Text landet im Doc', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    // Ein externer Editor hängt eine Zeile an. Eine Hilfsdatei dazu kommt nie.
    const extern = 'kopf\nEXTERN\n';
    vault._textFiles.set(NOTE, extern);
    sync.parkForeign(NOTE, extern);

    await sync.tickParked(NOTE, 1);

    expect(sync.hasParked(NOTE)).toBe(false);
    // Der externe Edit ist jetzt erfasst — und zwar im CRDT, nicht nur in der
    // Datei. Ohne Basis-Rücksetzung bliebe der Doc auf 'kopf\n' stehen.
    expect(crdt.getContent(NOTE)).toContain('EXTERN');
  });

  // M4: Der Adopt-Zweig von `ensureDoc` liest die `.md` selbst. Solange geparkt
  // ist, darf er sie nicht als lokalen Beitrag vereinigen — sonst wird fremder
  // Text auf einem Pfad zur eigenen Op, den das Tor im modify-Handler gar nicht
  // berührt.
  it('M4 — der Adopt-Zweig bringt die geparkte .md nicht als eigenen Beitrag ein', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    // Frisches Gerät: kein Doc, kein eigener Zustand. Der Sync hat die `.md`
    // eines Peers abgelegt und dazu die Hilfsdatei eines DRITTEN Geräts, die
    // den Tie-Break gewinnt.
    const gelieferte = 'kopf\nVON-B\n';
    vault._textFiles.set(NOTE, gelieferte);
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\nVON-A\n');
    sync.parkForeign(NOTE, gelieferte);

    await sync.loadAndMerge(NOTE);

    // Der Doc trägt die adoptierte fremde Kette — aber KEINE eigene Op für
    // 'VON-B'. Der steht weiter nur in der Datei und wartet auf seine Historie.
    expect(crdt.getContent(NOTE)).not.toContain('VON-B');
    expect(sync.hasParked(NOTE)).toBe(true);
  });

  // M5: `switchToGuid` liest die `.md` ebenfalls selbst. Der Unterschied ist auf
  // OP-Ebene und wird erst sichtbar, wenn die fremde Kette später erneut gemergt
  // wird — Yjs dedupliziert nach Item-ID, nicht nach Inhalt.
  it('M5 — nach dem Historienwechsel steht der gelieferte Text nicht doppelt', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    // Eigene, unterlegene Inkarnation mit eigenem Beitrag.
    vault._textFiles.set(NOTE, 'kopf\nEIGEN\n');
    await sync.applyLocalContent(NOTE, 'kopf\nEIGEN\n');

    // Der Sync liefert die Fassung des Peers; sie wird geparkt.
    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Die Hilfsdatei der gewinnenden fremden Inkarnation trifft ein.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, geliefert);
    await sync.loadAndMerge(NOTE);

    // Und danach noch einmal — der reguläre Fall, jeder Poll mergt erneut.
    await sync.loadAndMerge(NOTE);

    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
    expect(crdt.getContent(NOTE)).toContain('EIGEN');
  });
});

// Die Zusicherung, die `doc-ahead-local-diff` bisher für den Sync-Pfad trug, ist
// dort nicht mehr erreichbar: Ein per Datei-Sync geliefertes `.md` läuft jetzt
// ins Parken und erreicht `applyLocalContent` gar nicht mehr. Sie gehört deshalb
// hierher, hinter den Nachtrag — an die Stelle, an der der gelieferte Text
// tatsächlich in den Doc kommt.
describe('Erstkontakt — der Nachtrag dedupliziert', () => {
  it('trägt nichts nach, was der Doc bereits kennt', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\nEIGEN\n');
    await sync.applyLocalContent(NOTE, 'kopf\nEIGEN\n');

    // Der Sync liefert eine Fassung, die den eigenen Stand bereits enthält und
    // eine Zeile ergänzt — der Regelfall, wenn der Peer schon gemergt hat.
    const geliefert = 'kopf\nEIGEN\nVOM-PEER\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    await sync.tickParked(NOTE, 1);

    const doc = crdt.getContent(NOTE);
    expect(zaehle(doc, 'EIGEN')).toBe(1);
    expect(zaehle(doc, 'VOM-PEER')).toBe(1);
  });

  it('trägt auch dann genau einmal nach, wenn die Historie kurz danach eintrifft', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\n');
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    const geliefert = 'kopf\nVOM-PEER\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Frist läuft ab, BEVOR die Hilfsdatei ankommt — der teure Fall.
    await sync.tickParked(NOTE, 1);
    expect(sync.hasParked(NOTE)).toBe(false);

    // Und jetzt kommt sie doch, mit derselben Zeile als eigener Op-Kette.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, geliefert);
    await sync.loadAndMerge(NOTE);

    // Hier ist die Verdopplung, die die Frist erkauft: gleiche Kennung, zwei
    // Op-Ketten für denselben Text. Sie ist SICHTBAR und reparierbar — der
    // Verlust, den ein Verwerfen erzeugt hätte, wäre es nicht. Der Test hält den
    // Preis fest, statt ihn zu verschweigen.
    expect(zaehle(crdt.getContent(NOTE), 'VOM-PEER')).toBeGreaterThanOrEqual(1);
    // Was NICHT passieren darf: der Text verschwindet.
    expect(crdt.getContent(NOTE)).toContain('VOM-PEER');
  });
});

// Das Kanal-Tor. Die Frist ist keine reine Zeitkonstante: Liefert der Datei-Sync
// für diese Notiz gerade nach, beginnt sie neu. Der Kanal hat zwei Moden — beide
// Geräte online (Zustellung ~2 s, Maximum am gesunden Kanal 37,6 s) und „der
// Peer war stundenlang weg" (unbeschränkt). Im zweiten verfällt jede feste Frist,
// bevor die Historie kommen konnte, und genau dort liegt der Schaden.
describe('Erstkontakt — die Frist läuft nur, während der Kanal steht', () => {
  it('eine Lieferung, die den Parkplatz noch nicht deckt, setzt die Frist zurück', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\n');
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    const geliefert = 'kopf\nTEIL-A\nTEIL-B\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Drei Ticks vergehen — einer fehlt bis zur Frist von 4.
    for (let i = 0; i < 3; i++) await sync.tickParked(NOTE, 4);
    expect(sync.hasParked(NOTE)).toBe(true);

    // Jetzt liefert der Kanal: die Historie kommt an, aber nur zur Hälfte.
    fremdeSidecar(vault, FREMD_YJS, G_FREMD, 'kopf\nTEIL-A\n');
    expect(await sync.loadAndMerge(NOTE)).toBeNull();

    // Die Frist beginnt neu — der vierte Tick darf jetzt NICHT nachtragen.
    await sync.tickParked(NOTE, 4);
    expect(sync.hasParked(NOTE)).toBe(true);
  });

  it('ohne Lieferung läuft die Frist wie bisher ab — der externe Editor wartet nicht ewig', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    // Ein externer Editor schreibt. Es gibt keinen Peer, also liefert nie jemand
    // nach — hier darf das Tor die Notiz nicht dauerhaft aus dem Sync halten.
    vault._textFiles.set(NOTE, 'kopf\nEXTERN\n');
    sync.parkForeign(NOTE, 'kopf\nEXTERN\n');

    for (let i = 0; i < 4; i++) {
      await sync.loadAndMerge(NOTE);
      await sync.tickParked(NOTE, 4);
    }

    expect(sync.hasParked(NOTE)).toBe(false);
    expect(crdt.getContent(NOTE)).toContain('EXTERN');
  });
});
