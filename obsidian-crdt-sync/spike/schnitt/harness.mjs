// Gemeinsamer Unterbau der Machbarkeitsstudie „anderer Schnitt, anderer
// Erstkontakt?" — Transport, Szenario, Metrik. Die Schnitte selbst liegen in
// `schnitte.mjs`; hier steht nur, was fuer ALLE gleich sein muss, damit der
// Vergleich den Schnitt misst und nicht die Messumgebung.

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — jeder Lauf ist reproduzierbar.
// ---------------------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---------------------------------------------------------------------------
// Transport: ein fremder Datei-Sync.
//
// Modell (bewusst simpel, aber in der einen Eigenschaft genau, auf die es
// ankommt): Eine Datei wird hochgeladen, wenn sie `settle` Ticks lang NICHT mehr
// geschrieben wurde; sie kommt `delay` Ticks spaeter beim Peer an. Das ist das
// Verhalten von Syncthing/OneDrive/Dropbox bei einer Datei, die staendig weiter
// geschrieben wird — und es ist der einzige Modellteil, in dem sich die Schnitte
// strukturell unterscheiden duerfen: eine Datei, die bei JEDER Bearbeitung
// IRGENDEINER Notiz waechst, kommt spaeter zur Ruhe als eine, die nur bei ihrer
// eigenen Notiz waechst.
//
// `settle = 0` schaltet die Eigenschaft ab (jeder Write reist sofort los) — als
// Gegenprobe, damit sichtbar wird, welcher Teil des Ergebnisses daran haengt.
// ---------------------------------------------------------------------------
export class Transport {
  constructor({ settle = 10, delay = 20, jitter = 10, r, mdModus = 'kopie' }) {
    this.settle = settle;
    this.delay = delay;
    this.jitter = jitter;
    this.r = r;
    // Was tut der Datei-Sync, wenn die ankommende `.md` auf eine lokal
    // veraenderte trifft?
    //   'kopie'         — Konfliktkopie anlegen, die lokale Datei NICHT anfassen.
    //                     So verhalten sich Syncthing, OneDrive, Dropbox; die
    //                     Kopie ist fuer das Plugin unsichtbar. Damit bleibt der
    //                     reine CRDT-Pfad uebrig — der Modus, in dem der
    //                     Erstkontakt-Schaden ueberhaupt sichtbar wird.
    //   'ueberschreiben'— lokale Datei ueberschreiben (haerteste Annahme).
    this.mdModus = mdModus;
    this.letzterSyncStand = new Map();
    this.konfliktkopien = 0;
    this.pending = new Map(); // key `${owner}\0${path}` -> {owner,path,bytes,writtenAt,due}
    this.inFlight = []; // {path,bytes,owner,arriveAt}
    this.tick = 0;
    this.bytesTransferred = 0;
    this.transfers = 0;
  }

  // Ein Geraet hat eine Datei geschrieben. Erneutes Schreiben vor dem Upload
  // ersetzt den wartenden Stand (Koaleszenz) und setzt die Ruhefrist zurueck.
  write(owner, path, bytes) {
    const key = `${owner}\0${path}`;
    this.pending.set(key, { owner, path, bytes, writtenAt: this.tick });
  }

  // Eine Datei wird versiegelt (Segment-Roll): sie kann sofort losreisen, egal
  // wie aktiv das Geraet gerade ist.
  seal(owner, path) {
    const key = `${owner}\0${path}`;
    const p = this.pending.get(key);
    if (p) p.writtenAt = -1e9; // Ruhefrist sofort erfuellt
  }

  step(devices) {
    this.tick++;
    for (const [key, p] of [...this.pending]) {
      if (this.tick - p.writtenAt >= this.settle) {
        this.pending.delete(key);
        const d = this.delay + Math.floor(this.r() * this.jitter);
        this.inFlight.push({ ...p, arriveAt: this.tick + d });
        this.bytesTransferred += p.bytes.length ?? p.bytes.byteLength ?? 0;
        this.transfers++;
      }
    }
    const arrived = this.inFlight.filter((f) => f.arriveAt <= this.tick);
    this.inFlight = this.inFlight.filter((f) => f.arriveAt > this.tick);
    for (const f of arrived) {
      for (const dev of devices) {
        if (dev.id === f.owner) continue;
        if (f.path.endsWith('.md') && this.mdModus === 'kopie') {
          // Konflikterkennung wie ein echter Datei-Sync: verglichen wird gegen den
          // zuletzt GEMEINSAMEN Stand, nicht gegen den eigenen letzten Write.
          const key = `${dev.id}\0${f.path}`;
          const lokal = dev.currentText(f.path);
          const gemeinsam = this.letzterSyncStand.get(key);
          if (lokal === f.bytes) {
            this.letzterSyncStand.set(key, f.bytes);
            continue; // schon gleich, nichts zuzustellen
          }
          if (lokal !== gemeinsam) {
            // Beide Seiten haben seit dem letzten Abgleich geschrieben: der Sync
            // legt eine Konfliktkopie an und laesst die lokale Datei stehen.
            this.konfliktkopien++;
            continue;
          }
          this.letzterSyncStand.set(key, f.bytes);
        }
        dev.receiveFile(f.path, f.bytes);
      }
    }
    return arrived.length;
  }

  quiet() {
    return this.pending.size === 0 && this.inFlight.length === 0;
  }
}

// ---------------------------------------------------------------------------
// Szenario: der Erstkontakt-Fall.
//
// Ausgangslage ist genau die aus der Wissenspool-Note: beide Geraete besitzen die
// Notizen bereits byte-identisch (der Datei-Sync hat sie verteilt), KEINES hat
// eine Historie. Dann tippt jedes Geraet unabhaengig, bevor es die Historie des
// anderen gesehen hat.
// ---------------------------------------------------------------------------
export function buildScenario({ seed, nNotes = 20, baseLines = 8, editsPerDevice = 2, devices = 2, imprintWindow = 60 }) {
  const r = rng(seed);
  const deviceIds = [];
  for (let d = 0; d < devices; d++) {
    deviceIds.push(Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0').slice(0, 8));
  }
  const notes = [];
  for (let i = 0; i < nNotes; i++) {
    const path = `n${i}.md`;
    const lines = [];
    for (let l = 0; l < baseLines; l++) lines.push(`n${i}-base-${l}`);
    notes.push({ path, baseline: lines.join('\n') + '\n' });
  }
  // Wer bearbeitet wann welche Notiz? Jede Bearbeitung haengt eine eindeutige
  // Zeile an einer zufaelligen Position an.
  const events = [];
  for (let d = 0; d < devices; d++) {
    for (let k = 0; k < editsPerDevice * nNotes; k++) {
      const note = notes[Math.floor(r() * nNotes)];
      events.push({
        at: Math.floor(r() * imprintWindow),
        dev: d,
        note: note.path,
        token: `n${note.path.slice(1, -3)}-D${d}-${k}`,
        pos: r(),
      });
    }
  }
  events.sort((a, b) => a.at - b.at);
  return { notes, events, devices, deviceIds, rnd: r };
}

// Alle Tokens, die am Ende genau EINMAL dastehen muessen.
export function expectedTokens(scenario) {
  const per = new Map();
  for (const n of scenario.notes) {
    per.set(n.path, new Set(n.baseline.trim().split('\n')));
  }
  for (const e of scenario.events) per.get(e.note).add(e.token);
  return per;
}

// ---------------------------------------------------------------------------
// Metrik — Verlust und Verdopplung strikt getrennt.
//   Verlust:     ein erwartetes Token fehlt im Endtext.
//   Verdopplung: ein Token steht oefter da, als es erwartet wird.
// Beides in Tokens (Zeilen), nicht in Zeichen — eine Zeile ist die Einheit, in
// der der Nutzer den Schaden sieht.
// ---------------------------------------------------------------------------
export function score(scenario, devices) {
  const exp = expectedTokens(scenario);
  let verlust = 0, verdopplung = 0, notesMitVerlust = 0, notesMitVerdopplung = 0, divergent = 0;
  for (const n of scenario.notes) {
    const want = exp.get(n.path);
    let noteVerlust = 0, noteDup = 0;
    const texte = devices.map((d) => d.currentText(n.path));
    if (new Set(texte).size > 1) divergent++;
    // Bewertet wird Geraet 0 (bei Konvergenz sind alle gleich; Divergenz wird
    // separat gezaehlt, damit sie nicht als Verlust doppelt zaehlt).
    const counts = new Map();
    for (const line of texte[0].split('\n')) {
      if (line.length === 0) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    for (const t of want) {
      const c = counts.get(t) ?? 0;
      if (c === 0) noteVerlust++;
      else if (c > 1) noteDup += c - 1;
    }
    // Zeilen, die gar nicht erwartet werden (z. B. Merge-Artefakte), zaehlen als
    // Verdopplung nur, wenn sie eine erwartete Zeile mehrfach enthalten — dafuer
    // sorgt die Schleife oben. Fremdmaterial ohne Token wird nicht bewertet.
    verlust += noteVerlust;
    verdopplung += noteDup;
    if (noteVerlust > 0) notesMitVerlust++;
    if (noteDup > 0) notesMitVerdopplung++;
  }
  return { verlust, verdopplung, notesMitVerlust, notesMitVerdopplung, divergent };
}

// ---------------------------------------------------------------------------
// Treiber: laesst ein Szenario auf einer Schnitt-Implementierung laufen.
// ---------------------------------------------------------------------------
export async function run({ scenario, makeDevices, seed, settle = 10, delay = 20, poll = 30, maxTicks = 1200, mdModus = 'kopie' }) {
  const r = rng(seed ^ 0x5bf03635);
  const transport = new Transport({ settle, delay, jitter: 10, r, mdModus });
  const devices = await makeDevices(transport, scenario);

  // Ausgangslage: jede Notiz liegt auf JEDEM Geraet byte-identisch, ohne Historie.
  for (const dev of devices) {
    for (const n of scenario.notes) {
      dev.seedFile(n.path, n.baseline);
      transport.letzterSyncStand.set(`${dev.id}\0${n.path}`, n.baseline);
    }
  }

  let ei = 0;
  let ruheSeit = 0;
  for (let t = 0; t < maxTicks; t++) {
    while (ei < scenario.events.length && scenario.events[ei].at <= t) {
      const e = scenario.events[ei++];
      await devices[e.dev].userEdit(e.note, e.token, e.pos);
    }
    for (const dev of devices) await dev.onTick?.(t);
    transport.step(devices);
    if (t % poll === 0) for (const dev of devices) await dev.poll();
    const fertig = ei >= scenario.events.length && transport.quiet();
    ruheSeit = fertig ? ruheSeit + 1 : 0;
    if (ruheSeit > poll * 2) break;
  }
  // Nachlauf: alles zustellen und zweimal pollen, damit kein Ergebnis nur an
  // einem abgeschnittenen Ende haengt.
  for (let i = 0; i < 6; i++) {
    for (const dev of devices) await dev.onTick?.(transport.tick, true);
    for (let k = 0; k < delay + settle + 5; k++) transport.step(devices);
    for (const dev of devices) await dev.poll();
  }
  return { devices, transport };
}
