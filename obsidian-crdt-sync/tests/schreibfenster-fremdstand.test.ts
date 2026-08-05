// DAS SCHREIBFENSTER — was der Laufzeitzähler durchlässt, solange er offen ist.
//
// `istEigen` kennt zwei Wege zu „ja": der Inhalt passt zum zuletzt selbst
// geschriebenen Stand, ODER für diesen Pfad läuft gerade ein eigener
// Schreibvorgang (`laufend > 0`). Der zweite Weg prüft den Inhalt NICHT — er
// sagt nur „ich schreibe hier gerade". Solange er offen ist, gilt JEDER Text
// auf diesem Pfad als eigen, auch ein von außen gelieferter.
//
// Auf einer lokalen SSD ist das Fenster einen Bruchteil einer Millisekunde breit
// (Messung unten). Es ist aber keine Konstante der Klasse, sondern die Laufzeit
// des darunterliegenden Schreibvorgangs: Netzlaufwerk, WSL-Mount oder ein
// rehydrierender OneDrive-Platzhalter dehnen es auf Sekunden. Genau in dieser
// Größenordnung liefert ein Datei-Sync — der belegte Regelfall ist, dass die
// `.md` des Peers VOR dessen Hilfsdatei eintrifft und Obsidian dafür `modify`
// feuert.
//
// Diese Datei belegt, was in diesem Fenster passiert: der gelieferte Stand wird
// nicht geparkt, sondern als eigene Bearbeitung verbucht — also genau der
// Schaden, den das Tor verhindern soll (Verdopplung, `parken-fremder-md.test.ts`).

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { WriteProvenance } from '../src/write-provenance';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const FREMD_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_FREMD = '00000000000000000000000000000000';

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

function fremdeSidecar(vault: any, guid: string, text: string): void {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  vault._files.set(FREMD_YJS, toAB(encodeStateFile(guid, m.encodeState(NOTE))));
}

// Ein langsames Dateisystem unter dem Adapter. Die Bremse wird VOR `onload`
// eingehängt, damit die Schreibspur SIE umhüllt und nicht umgekehrt — sonst
// stünde der Zähler während der Verzögerung noch auf 0 und der Test prüfte das
// Gegenteil dessen, worum es geht.
function bremse(vault: any): { sperren(): void; freigeben(): void } {
  const roh = vault.adapter.write.bind(vault.adapter);
  let sperre: Promise<void> | null = null;
  let oeffne: (() => void) | null = null;
  vault.adapter.write = async (p: string, d: string): Promise<void> => {
    if (sperre) await sperre;
    return roh(p, d);
  };
  return {
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
  };
}

// Ein Gerät über den ECHTEN onload-Pfad — das Tor sitzt im modify-Handler von
// main.ts, nicht in einer hier nachgebauten Verdrahtung.
async function bootDevice(vault: any): Promise<{ plugin: any; handlers: Map<string, any> }> {
  const handlers = new Map<string, (...args: any[]) => any>();
  const storage = makeLocalStorage();
  const app = {
    vault: Object.assign(vault, {
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    }),
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers };
}

// Ein Schreibvorgang DIESES Prozesses auf die `.md` — Editor-Autosave, eine
// Kernfunktion, ein fremdes Plugin. Bewusst NICHT der Write-Back von Qollab
// selbst: der hält `writingPaths` und unterdrückt sein eigenes modify-Ereignis,
// erreicht das Tor also gar nicht. Der Zähler ist genau für die anderen
// prozessinternen Schreiber da.
function tippt(vault: any, text: string): Promise<void> {
  return vault.adapter.write(NOTE, text);
}

describe('Schreibfenster — der Laufzeitzähler prüft den Inhalt nicht', () => {
  it('ein hängender write/process adelt einen Fremdstand NICHT mehr', async () => {
    const vault = makeVaultMock() as any;
    const b = bremse(vault);
    const wp = new WriteProvenance(vault.adapter);
    wp.install();

    await tippt(vault, 'kopf\n');
    expect(wp.istEigen(NOTE, 'kopf\nFREMD\n')).toBe(false);

    // Derselbe Pfad, derselbe Text — nur hängt jetzt ein eigener Write.
    b.sperren();
    const laufend = tippt(vault, 'kopf\n');

    // FRÜHER stand hier `true`: Der Laufzeitzähler adelte jeden Text auf diesem
    // Pfad, ohne ihn anzusehen. Für `write`/`process` ist er abgeschaltet — dort
    // steht der Endstand synchron vor dem Aufruf fest, und die Inhaltsregel
    // trägt allein.
    expect(wp.istEigen(NOTE, 'kopf\nFREMD\n')).toBe(false);
    expect(wp.istEigen(NOTE, 'ein voellig anderer Text, nie geschrieben')).toBe(false);

    b.freigeben();
    await laufend;

    // Nach dem Abschluss trägt wieder die Inhaltsregel.
    expect(wp.istEigen(NOTE, 'kopf\nFREMD\n')).toBe(false);
  });
});

// Der Ablauf ist derselbe wie in `parken-fremder-md.test.ts` (SCHADENSWEG /
// GEGENPROBE), nur entscheidet hier das Tor aus main.ts selbst — und der einzige
// Unterschied zwischen den beiden Fällen ist, ob im Moment des Ereignisses ein
// eigener Write hängt.
describe('Schreibfenster — Folge am echten modify-Handler', () => {
  async function aufbau(): Promise<{ vault: any; plugin: any; modify: any; b: any }> {
    const vault = makeVaultMock() as any;
    const b = bremse(vault);
    const { plugin, handlers } = await bootDevice(vault);
    const modify = handlers.get('modify')!;

    // Gemeinsame Historie: der Peer hat sie geprägt, dieses Gerät adoptiert sie.
    fremdeSidecar(vault, G_FREMD, 'kopf\n');
    await tippt(vault, 'kopf\n');
    await modify(vault.getAbstractFileByPath(NOTE) as TFile);

    // Der Peer tippt FREMD — eigene Op-Kette unter DERSELBEN Kennung. Die
    // Hilfsdatei ist noch unterwegs.
    fremdeSidecar(vault, G_FREMD, 'kopf\nFREMD\n');
    const peerSidecar = vault._files.get(FREMD_YJS)!;
    fremdeSidecar(vault, G_FREMD, 'kopf\n');
    (vault as any)._peerSidecar = peerSidecar;

    return { vault, plugin, modify, b };
  }

  it('Fremdstand während eines hängenden Writes wird geparkt statt verbucht', async () => {
    const { vault, plugin, modify, b } = await aufbau();

    // Ein eigener Schreibvorgang hängt (Netzlaufwerk, WSL, rehydrierender
    // OneDrive-Platzhalter). In genau diesem Fenster legt der Datei-Sync die
    // `.md` des Peers ab und Obsidian meldet `modify`.
    b.sperren();
    const haengt = tippt(vault, 'kopf\n');
    vault._textFiles.set(NOTE, 'kopf\nFREMD\n');

    // FRÜHER `true` — und genau das war der Schaden: Das Tor winkte den
    // gelieferten Stand ungeprüft durch.
    expect(plugin.writeProvenance.istEigen(NOTE, 'kopf\nFREMD\n')).toBe(false);
    await modify(vault.getAbstractFileByPath(NOTE) as TFile);

    b.freigeben();
    await haengt;

    // Jetzt wird geparkt, obwohl ein eigener Write hängt.
    expect(plugin.syncHandler.hasParked(NOTE)).toBe(true);

    // Und wenn die Hilfsdatei des Peers eintrifft, steht der Text GENAU EINMAL
    // im Doc — vorher waren es zwei Op-Ketten für denselben Text.
    vault._files.set(FREMD_YJS, (vault as any)._peerSidecar);
    await plugin.syncHandler.loadAndMerge(NOTE);

    expect(zaehle(plugin.crdtManager.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('GEGENPROBE: derselbe Fremdstand NACH dem Write ⇒ geparkt, genau einmal', async () => {
    const { vault, plugin, modify } = await aufbau();

    // Kein hängender Write — sonst identischer Ablauf.
    vault._textFiles.set(NOTE, 'kopf\nFREMD\n');

    expect(plugin.writeProvenance.istEigen(NOTE, 'kopf\nFREMD\n')).toBe(false);
    await modify(vault.getAbstractFileByPath(NOTE) as TFile);

    expect(plugin.syncHandler.hasParked(NOTE)).toBe(true);
    expect(plugin.crdtManager.getContent(NOTE)).not.toContain('FREMD');

    vault._files.set(FREMD_YJS, (vault as any)._peerSidecar);
    await plugin.syncHandler.loadAndMerge(NOTE);

    expect(zaehle(plugin.crdtManager.getContent(NOTE), 'FREMD')).toBe(1);
  });
});

// Wie breit ist das Fenster auf ECHTEM Dateisystem? Die Frage ist nicht
// akademisch: die Klasse hat keine eigene Zeitkonstante, das Fenster IST die
// Laufzeit des darunterliegenden Schreibvorgangs. Gemessen wird deshalb am
// Temp-Verzeichnis dieses Rechners (lokale Platte) — die untere Schranke.
// Netzlaufwerk/Platzhalter-Rehydrierung liegen um Größenordnungen darüber.
describe('Schreibfenster — Breite auf echtem Dateisystem', () => {
  it('ein gewöhnlicher Write öffnet gar kein Fenster mehr', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qollab-schreibfenster-'));
    const datei = path.join(dir, 'note.md');
    const text = 'Zeile mit etwas Text, wie in einer echten Notiz.\n'.repeat(80); // ~3,8 KB

    const adapter = {
      write: (p: string, d: string) => fs.writeFile(p, d, 'utf8'),
      process: async (p: string, fn: (data: string) => string) => fn(await fs.readFile(p, 'utf8')),
      append: (p: string, d: string) => fs.appendFile(p, d, 'utf8'),
    };
    const wp = new WriteProvenance(adapter);
    wp.install();

    try {
      for (let i = 0; i < 20; i++) await adapter.write(datei, text); // aufwärmen

      const proben: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        const p = adapter.write(datei, text);
        // FRÜHER war ein NIE geschriebener Text hier „eigen" — das Fenster ist
        // für `write` geschlossen.
        expect(wp.istEigen(datei, 'von aussen geliefert')).toBe(false);
        await p;
        proben.push(performance.now() - t0);
        // Das `.then(senke)` der Umhüllung ist vor dieser Fortsetzung gelaufen.
        expect(wp.istEigen(datei, 'von aussen geliefert')).toBe(false);
      }

      proben.sort((a, b) => a - b);
      const median = proben[Math.floor(proben.length / 2)];
      const p95 = proben[Math.floor(proben.length * 0.95)];
      // eslint-disable-next-line no-console
      console.log(
        `Schreibfenster (lokale Platte, ~3,8 KB, n=${proben.length}): ` +
          `median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${proben[proben.length - 1].toFixed(3)} ms`
      );

      // Die Zusicherung ist bewusst grob: geprüft wird, dass das Fenster
      // ÜBERHAUPT an der Schreibdauer hängt und wieder zugeht — nicht eine
      // Rechnerleistung.
      expect(median).toBeLessThan(500);
    } finally {
      wp.uninstall();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
