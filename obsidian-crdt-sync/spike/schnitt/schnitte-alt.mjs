// Die vier Schnitte als Machbarkeitsstudie. Gemeinsam ist ihnen der Treiber aus
// `harness.mjs`; unterschiedlich ist ausschliesslich, WAS die Einheit der
// Historie ist und WORAUS die Identitaet eines Elements kommt.
//
//   S0real  Ist-Schnitt am ECHTEN Produktionscode (Sidecar je Notiz je Geraet)
//   S0mod   Ist-Schnitt im Modell            — Kontrollgruppe fuer S1
//   S1seg   GH-12: Append-only-Segmente je Geraet (Frame traegt Inkarnations-GUID)
//   S1stab  dasselbe, aber der Frame traegt eine STABILE Notiz-Kennung
//   S2vault Vault-weiter Schnitt (ein Y.Doc, Notizen als Y.Map-Schluessel)
//   S3log   inhaltsadressiertes ZUSTANDS-Log (kein CRDT, 3-Wege-Merge)
//
// Gemeinsame Regel fuer alle: die `.md` wird bei Ankunft SOFORT verarbeitet
// (Obsidians modify-Event), Historie erst beim Poll. Das ist die dokumentierte
// Ursache-Asymmetrie („Datei vor Historie") und gilt fuer jeden Schnitt gleich.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const R = require('./real.cjs');
const Y = require('yjs');
const DMP = new (require('diff-match-patch').diff_match_patch)();

const sha = (s) => createHash('sha256').update(s).digest('hex');
const guid32 = (r) =>
  Array.from({ length: 8 }, () => Math.floor(r() * 65536).toString(16).padStart(4, '0')).join('');
let FRAME_ID = 0;

// ---------------------------------------------------------------------------
// Zeilenweiser 3-Wege-Merge gegen einen ECHTEN gemeinsamen Vorfahren.
//
// Bewusst NICHT `threeWayMerge` aus text-merge.ts: das benutzt `patch_apply`,
// einen Fuzzy-Patcher ohne Rueckkanal — er verwirft Hunks still (dokumentiert in
// text-merge.ts). Wo ein echter Vorfahr vorliegt, ist der Fuzz unnoetig: beide
// Seiten werden gegen die Basis aufgeloest, ueberlappende Aenderungen bleiben
// BEIDE stehen. Damit kann dieser Merge nichts verlieren, was eine Seite
// hinzugefuegt hat — Konflikte werden sichtbar statt still entschieden.
// ---------------------------------------------------------------------------
function zeilenDiff(o, x) {
  const { chars1, chars2, lineArray } = DMP.diff_linesToChars_(o, x);
  const d = DMP.diff_main(chars1, chars2, false);
  DMP.diff_charsToLines_(d, lineArray);
  return d;
}
// Hunks als (basisStart, basisEnde, ersatzZeilen).
function hunks(base, x) {
  const out = [];
  let i = 0;
  const d = zeilenDiff(base, x);
  for (let k = 0; k < d.length; k++) {
    const [op, txt] = d[k];
    const zeilen = txt.length ? txt.split('\n').slice(0, -1).map((l) => l + '\n') : [];
    if (op === 0) { i += zeilen.length; continue; }
    if (op === -1) {
      let ersatz = [];
      if (k + 1 < d.length && d[k + 1][0] === 1) {
        const t = d[k + 1][1];
        ersatz = t.length ? t.split('\n').slice(0, -1).map((l) => l + '\n') : [];
        k++;
      }
      out.push([i, i + zeilen.length, ersatz]);
      i += zeilen.length;
    } else {
      out.push([i, i, zeilen]);
    }
  }
  return out;
}
export function dreiWegeZeilen(base, a, b) {
  const ob = base.length ? base.split('\n').slice(0, -1).map((l) => l + '\n') : [];
  const ha = hunks(base, a), hb = hunks(base, b);
  const out = [];
  let i = 0, ia = 0, ib = 0;
  while (i <= ob.length) {
    const na = ha[ia], nb = hb[ib];
    const sa = na ? na[0] : Infinity, sb = nb ? nb[0] : Infinity;
    if (sa === Infinity && sb === Infinity) break;
    const start = Math.min(sa, sb);
    for (; i < start && i < ob.length; i++) out.push(ob[i]);
    // Alle Hunks einsammeln, die an dieser Basisstelle beginnen.
    const aH = [], bH = [];
    let ende = start;
    while (ha[ia] && ha[ia][0] <= ende) { ende = Math.max(ende, ha[ia][1]); aH.push(ha[ia++]); }
    while (hb[ib] && hb[ib][0] <= ende) { ende = Math.max(ende, hb[ib][1]); bH.push(hb[ib++]); }
    while ((ha[ia] && ha[ia][0] < ende) || (hb[ib] && hb[ib][0] < ende)) {
      if (ha[ia] && ha[ia][0] < ende) { ende = Math.max(ende, ha[ia][1]); aH.push(ha[ia++]); }
      if (hb[ib] && hb[ib][0] < ende) { ende = Math.max(ende, hb[ib][1]); bH.push(hb[ib++]); }
    }
    const bau = (hs) => {
      const res = [];
      let p = start;
      for (const [s, e, r] of hs) { for (; p < s; p++) res.push(ob[p]); res.push(...r); p = e; }
      for (; p < ende; p++) res.push(ob[p]);
      return res;
    };
    const va = aH.length ? bau(aH) : ob.slice(start, ende);
    const vb = bH.length ? bau(bH) : ob.slice(start, ende);
    if (va.join('') === vb.join('')) out.push(...va);
    else if (aH.length === 0) out.push(...vb);
    else if (bH.length === 0) out.push(...va);
    else {
      // Beide Seiten haben dieselbe Stelle angefasst: beide Fassungen behalten,
      // in fester Reihenfolge, damit beide Geraete dasselbe rechnen.
      const [x, y] = [va.join(''), vb.join('')].sort();
      out.push(x, y);
    }
    i = ende;
  }
  for (; i < ob.length; i++) out.push(ob[i]);
  return out.join('');
}

// Zeile an relativer Position einfuegen — die „Nutzereingabe".
function insertLine(text, token, pos) {
  const lines = text.split('\n');
  const at = Math.max(1, Math.min(lines.length - 1, Math.floor(pos * lines.length)));
  lines.splice(at, 0, token);
  return lines.join('\n');
}

// ===========================================================================
// S0real / S1real — DER KERNVERSUCH.
//
// Beide laufen auf dem UNVERAENDERTEN Produktionscode; verschieden ist einzig
// die Ablage der Historie:
//   layout 'sidecar'  eine Datei je (Notiz, Geraet)      — der Ist-Schnitt
//   layout 'segment'  ein Strom je Geraet, note-uebergreifend — GH-12
//
// Das ist die saubere Isolierung: die Merge-Logik ist BITGLEICH dieselbe, es
// aendert sich nur, in welcher Datei ein Yjs-Update reist und wann diese Datei
// zur Ruhe kommt. Jeder Unterschied im Ergebnis IST der Schnitt.
// ===========================================================================
export function makeS0real(transport, scenario, { layout = 'sidecar', rollTicks = 900 } = {}) {
  return scenario.deviceIds.map((clientId) => {
    const vault = R.makeVaultMock();
    let segSeq = 0, segFrames = [], segStart = 0, dateien = 0;
    const gesehen = new Set();
    const packSeg = (frames) => {
      let n = 0;
      for (const f of frames) n += 24 + f.bytes.length;
      const out = new Uint8Array(n);
      out.frames = frames.slice();
      return out;
    };
    const orig = vault.adapter.writeBinary;
    vault.adapter.writeBinary = async (p, data) => {
      await orig(p, data);
      const bytes = new Uint8Array(R.toArrayBuffer(data));
      if (layout === 'sidecar') {
        transport.write(clientId, p, bytes);
      } else {
        // Ein Frame je Sidecar-Write, alle Notizen dieses Geraets in EINEM Strom.
        segFrames.push({ path: p, bytes, fid: ++FRAME_ID });
        transport.write(clientId, `.qollab/${clientId}/seg-${segSeq}.qlb`, packSeg(segFrames));
      }
    };
    // Die Instrumentierung des Produktionscodes selbst: `onUnrelatedMerge` feuert,
    // wenn zwei unverwandte Ketten vereinigt wurden und BEIDE beigetragen haben;
    // `onDiscardedIncarnation`, wenn eine getrennt entstandene Fassung NICHT
    // uebernommen wurde. Zusammen sind das genau die Erstkontakt-Ereignisse.
    const zaehler = { vereinigt: 0, verworfen: 0 };
    const handler = new R.SyncHandler(
      vault, new R.CrdtManager(), clientId, undefined, undefined, undefined, undefined,
      () => zaehler.vereinigt++,
      () => zaehler.verworfen++
    );
    const pendingHistory = new Set();

    const schreibeMd = (path, text) => {
      vault._textFiles.set(path, text);
      transport.write(clientId, path, text);
    };

    const verarbeiteLokal = async (path, text) => {
      const merged = await handler.applyLocalContent(path, text);
      if (merged !== undefined && merged !== text) schreibeMd(path, merged);
    };

    return {
      id: clientId,
      seedFile(path, text) {
        vault._textFiles.set(path, text);
      },
      async userEdit(path, token, pos) {
        const neu = insertLine(vault._textFiles.get(path) ?? '', token, pos);
        schreibeMd(path, neu);
        await verarbeiteLokal(path, neu);
      },
      receiveFile(path, bytes) {
        if (path.endsWith('.md')) {
          // Obsidian meldet die Fremdaenderung sofort.
          vault._textFiles.set(path, bytes);
          this._sofort.push(path);
          return;
        }
        const lege = (p, b) => {
          vault._files.set(p, R.toArrayBuffer(b));
          pendingHistory.add(p.slice('.qollab/'.length).replace(/\.[0-9a-f]{8}\.yjs$/, ''));
        };
        if (layout === 'sidecar') lege(path, bytes);
        else
          for (const f of bytes.frames ?? []) {
            if (gesehen.has(f.fid)) continue;
            gesehen.add(f.fid);
            lege(f.path, f.bytes);
          }
      },
      _sofort: [],
      async onTick(t, final) {
        while (this._sofort.length) {
          const p = this._sofort.shift();
          await verarbeiteLokal(p, vault._textFiles.get(p));
        }
        if (layout === 'segment' && (final || t - segStart >= rollTicks)) {
          segStart = t;
          if (segFrames.length) {
            transport.seal(clientId, `.qollab/${clientId}/seg-${segSeq}.qlb`);
            dateien++; segSeq++; segFrames = [];
          }
        }
      },
      async poll() {
        await this.onTick(transport.tick);
        for (const note of [...pendingHistory]) {
          pendingHistory.delete(note);
          const merged = await handler.loadAndMerge(note);
          if (merged !== null && merged !== vault._textFiles.get(note)) schreibeMd(note, merged);
        }
      },
      currentText: (path) => vault._textFiles.get(path) ?? '',
      stats: () => ({
        dateien: layout === 'segment' ? dateien + 1 : vault._files.size,
        erstkontakt: zaehler.vereinigt + zaehler.verworfen,
        vereinigt: zaehler.vereinigt,
        verworfen: zaehler.verworfen,
      }),
    };
  });
}

export const makeS1real = (tr, sc, o = {}) =>
  makeS0real(tr, sc, { layout: 'segment', rollTicks: o.rollTicks ?? 900 });

// ===========================================================================
// Gemeinsame Modell-Basis fuer S0mod / S1seg / S1stab.
//
// Ein Y.Doc je Notiz — wie heute. Verschieden ist nur die Ablage:
//   layout 'sidecar'  eine Volldatei je (Notiz, Geraet)
//   layout 'segment'  ein Strom von Frames je Geraet, Frame = (Kennung, Delta)
// und, was der Frame als Kennung traegt: die Inkarnations-GUID (wie heute) oder
// eine stabile, aus dem Pfad abgeleitete Notiz-Kennung.
// ===========================================================================
function makeModelDevices(transport, scenario, { layout, stableId = false, rollTicks = 900 }) {
  const r = scenario.rnd;
  return scenario.deviceIds.map((clientId, idx) => {
    const md = new Map();
    const docs = new Map(); // note -> Y.Doc
    const guids = new Map(); // note -> guid
    const sent = new Map(); // note -> state vector (was schon rausgeschrieben ist)
    const fremd = new Map(); // note -> [{guid, update}] noch nicht verarbeitet
    const letzteMd = new Map(); // note -> zuletzt gesehener .md-Text (localDiffBase)
    const gesehen = new Set(); // Segment-Frames, die schon eingelesen sind
    let segSeq = 0, segBytes = [], segStart = 0, dateien = 0;

    const guidOf = (note) => (stableId ? sha(note).slice(0, 32) : guids.get(note));

    const framePack = (frames) => {
      let n = 0;
      for (const f of frames) n += 24 + f.update.length;
      const out = new Uint8Array(n);
      out.frames = frames.slice(); // Momentaufnahme — spaetere Frames reisen nicht mit
      return out;
    };

    const persist = (note) => {
      const doc = docs.get(note);
      const vor = sent.get(note);
      const delta = vor ? Y.encodeStateAsUpdate(doc, vor) : Y.encodeStateAsUpdate(doc);
      sent.set(note, Y.encodeStateVector(doc));
      if (layout === 'sidecar') {
        const bytes = R.encodeStateFile(guidOf(note), Y.encodeStateAsUpdate(doc));
        transport.write(clientId, `.qollab/${note}.${clientId}.yjs`, new Uint8Array(bytes));
      } else {
        if (delta.length <= 2) return; // nichts Neues
        segBytes.push({ guid: guidOf(note), note, update: delta, fid: ++FRAME_ID });
        transport.write(clientId, `.qollab/${clientId}/seg-${segSeq}.qlb`, framePack(segBytes));
      }
    };

    const roll = () => {
      if (segBytes.length === 0) return;
      transport.seal(clientId, `.qollab/${clientId}/seg-${segSeq}.qlb`);
      dateien++;
      segSeq++;
      segBytes = [];
      // Der neue Strom beginnt leer; bereits gesendete Deltas sind versiegelt.
    };

    // --- CRDT-Kern, bewusst nah an sync-handler.ts ---------------------------
    const text = (note) => docs.get(note)?.getText('content').toString() ?? '';
    // Diff-basiert ueber den ECHTEN CrdtManager: unveraenderte Zeichen behalten
    // ihre Item-IDs, exakt wie im Produktionscode.
    const setContent = (note, neu) => {
      const doc = docs.get(note);
      if (doc.getText('content').toString() === neu) return;
      const m = new R.CrdtManager();
      m.applyUpdate(note, Y.encodeStateAsUpdate(doc));
      m.setContent(note, neu);
      Y.applyUpdate(doc, m.encodeState(note));
      m.disposeAll();
    };

    const mergeFremd = (note) => {
      const liste = fremd.get(note) ?? [];
      fremd.set(note, []);
      if (liste.length === 0) return;
      const eigen = guidOf(note);
      if (!docs.has(note)) {
        // ADOPT: keine eigene Historie -> die fremde uebernehmen. Genau dieser
        // Zweig verhindert den Erstkontakt, wenn die Historie VOR der .md kommt.
        const gewinner = liste.map((x) => x.guid).sort()[0];
        docs.set(note, new Y.Doc());
        guids.set(note, gewinner);
        for (const x of liste) if (x.guid === gewinner) Y.applyUpdate(docs.get(note), x.update);
        return;
      }
      const kandidaten = [...new Set([eigen, ...liste.map((x) => x.guid)])].sort();
      const gewinner = kandidaten[0];
      if (gewinner === eigen) {
        for (const x of liste) if (x.guid === eigen) Y.applyUpdate(docs.get(note), x.update);
        return;
      }
      // Verlierer: eigene Historie verwerfen, lokalen Stand als frische Op
      // wieder einbringen — das ist switchToGuid.
      const lokal = R.unionMerge(text(note), md.get(note) ?? '');
      docs.set(note, new Y.Doc());
      guids.set(note, gewinner);
      sent.delete(note);
      for (const x of liste) if (x.guid === gewinner) Y.applyUpdate(docs.get(note), x.update);
      const gewinnerText = text(note);
      if (gewinnerText !== lokal) setContent(note, R.unionMerge(gewinnerText, lokal));
    };

    // Basiswahl wie `chooseLocalDiffBase` im Produktionscode.
    const basisWahl = (note, inhalt, docVorher, gemergt) => {
      const zuletzt = letzteMd.get(note);
      if (zuletzt === undefined) return docVorher;
      const vorlauf = R.insertedTexts(zuletzt, gemergt);
      if (vorlauf.length === 0) return zuletzt;
      return vorlauf.some((l) => inhalt.includes(l)) ? docVorher : zuletzt;
    };

    const onLocalContent = (note, inhalt) => {
      let adoptiert = false;
      if (!docs.has(note)) {
        if ((fremd.get(note) ?? []).length > 0) { mergeFremd(note); adoptiert = docs.has(note); }
        if (!docs.has(note)) {
          // GENESIS mit eigener, zufaelliger Kennung — der Erstkontakt-Moment.
          docs.set(note, new Y.Doc());
          guids.set(note, guid32(r));
        }
      }
      const docVorher = text(note);
      mergeFremd(note);
      const gemergt = text(note);
      let final;
      if (inhalt === gemergt) final = gemergt;
      else if (adoptiert) final = R.unionMerge(gemergt, inhalt);
      else final = R.threeWayMerge(basisWahl(note, inhalt, docVorher, gemergt), inhalt, gemergt);
      setContent(note, final);
      persist(note);
      md.set(note, final);
      letzteMd.set(note, inhalt);
      return final;
    };

    return {
      id: clientId,
      seedFile: (p, t) => md.set(p, t),
      async userEdit(path, token, pos) {
        const neu = insertLine(md.get(path) ?? '', token, pos);
        md.set(path, neu);
        const final = onLocalContent(path, neu);
        transport.write(clientId, path, final);
      },
      receiveFile(path, bytes) {
        if (path.endsWith('.md')) {
          md.set(path, bytes);
          this._sofort.push(path);
        } else if (layout === 'sidecar') {
          const { guid, update } = R.decodeStateFile(new Uint8Array(bytes));
          const note = path.slice('.qollab/'.length).replace(/\.[0-9a-f]{8}\.yjs$/, '');
          if (!fremd.has(note)) fremd.set(note, []);
          fremd.get(note).push({ guid, update });
        } else {
          for (const f of bytes.frames ?? []) {
            if (gesehen.has(f.fid)) continue;
            gesehen.add(f.fid);
            if (!fremd.has(f.note)) fremd.set(f.note, []);
            fremd.get(f.note).push({ guid: f.guid, update: f.update });
          }
        }
      },
      _sofort: [],
      async onTick(t, final) {
        while (this._sofort.length) {
          const p = this._sofort.shift();
          const res = onLocalContent(p, md.get(p));
          transport.write(clientId, p, res);
        }
        if (layout === 'segment' && (final || t - segStart >= rollTicks)) {
          segStart = t;
          roll();
        }
      },
      async poll() {
        await this.onTick(transport.tick);
        for (const note of [...fremd.keys()]) {
          if ((fremd.get(note) ?? []).length === 0) continue;
          mergeFremd(note);
          const neu = text(note);
          if (neu !== md.get(note)) {
            md.set(note, neu);
            transport.write(clientId, note, neu);
            persist(note);
          }
        }
      },
      currentText: (p) => md.get(p) ?? '',
      stats: () => ({ dateien: layout === 'segment' ? dateien + 1 : docs.size }),
    };
  });
}

export const makeS0mod = (tr, sc) => makeModelDevices(tr, sc, { layout: 'sidecar' });
export const makeS1seg = (tr, sc, o = {}) =>
  makeModelDevices(tr, sc, { layout: 'segment', rollTicks: o.rollTicks ?? 900 });
export const makeS1stab = (tr, sc, o = {}) =>
  makeModelDevices(tr, sc, { layout: 'segment', stableId: true, rollTicks: o.rollTicks ?? 900 });

// ===========================================================================
// S2 — vault-weiter Schnitt: EIN Y.Doc, Notizen als Schluessel einer Y.Map.
//   variante 'frei'         beide Geraete praegen den Vault-Doc unabhaengig
//   variante 'einrichtung'  ein Geraet praegt, die anderen VERWEIGERN, bis sie
//                           den Vault-Stand adoptiert haben
// ===========================================================================
export function makeS2vault(transport, scenario, { variante = 'frei', rollTicks = 900 } = {}) {
  return scenario.deviceIds.map((clientId, idx) => {
    const md = new Map();
    let doc = null;
    let adoptiert = false;
    let sent = null;
    let segSeq = 0, segFrames = [], segStart = 0, dateien = 0;
    const gesehen = new Set();
    const wartend = []; // Notizen, die vor der Adoption bearbeitet wurden
    const darfPraegen = variante === 'frei' || idx === 0;

    const pack = (frames) => {
      let n = 0;
      for (const f of frames) n += 8 + f.update.length;
      const out = new Uint8Array(n);
      out.frames = frames.slice();
      return out;
    };
    const persist = () => {
      const delta = sent ? Y.encodeStateAsUpdate(doc, sent) : Y.encodeStateAsUpdate(doc);
      sent = Y.encodeStateVector(doc);
      if (delta.length <= 2) return;
      segFrames.push({ update: delta, fid: ++FRAME_ID });
      transport.write(clientId, `.qollab/${clientId}/vseg-${segSeq}.qlb`, pack(segFrames));
    };
    const notes = () => doc.getMap('notes');
    const textOf = (p) => {
      if (!doc) return md.get(p) ?? '';
      const t = notes().get(p);
      return t ? t.toString() : (md.get(p) ?? '');
    };
    const setNote = (p, neu) => {
      const m = notes();
      let t = m.get(p);
      if (!t) {
        // Der Erstkontakt des vault-weiten Schnitts: ein NEUER Schluessel.
        t = new Y.Text();
        t.insert(0, neu);
        m.set(p, t); // konkurrierende `set` desselben Schluessels -> LWW
        return;
      }
      const cur = t.toString();
      if (cur === neu) return;
      // Diff-basiert wie im Produktionscode.
      const diffs = DMP.diff_main(cur, neu);
      doc.transact(() => {
        let pos = 0;
        for (const [op, data] of diffs) {
          if (op === 0) pos += data.length;
          else if (op === 1) { t.insert(pos, data); pos += data.length; }
          else t.delete(pos, data.length);
        }
      });
    };

    const onLocalContent = (p, inhalt) => {
      if (!doc) {
        if (!darfPraegen && !adoptiert) {
          // VERWEIGERUNG: keine Historie praegen, nur die Datei fuehren.
          md.set(p, inhalt);
          if (!wartend.includes(p)) wartend.push(p);
          return inhalt;
        }
        doc = new Y.Doc();
      }
      const cur = textOf(p);
      const final = cur === inhalt ? inhalt : R.unionMerge(cur, inhalt);
      setNote(p, final);
      persist();
      md.set(p, final);
      return final;
    };

    return {
      id: clientId,
      seedFile: (p, t) => md.set(p, t),
      async userEdit(path, token, pos) {
        const neu = insertLine(md.get(path) ?? '', token, pos);
        md.set(path, neu);
        const f = onLocalContent(path, neu);
        transport.write(clientId, path, f);
      },
      receiveFile(path, bytes) {
        if (path.endsWith('.md')) { md.set(path, bytes); this._sofort.push(path); return; }
        for (const f of bytes.frames ?? []) {
          if (gesehen.has(f.fid)) continue;
          gesehen.add(f.fid);
          this._eingang.push(f.update);
        }
      },
      _sofort: [], _eingang: [],
      async onTick(t, final) {
        while (this._sofort.length) {
          const p = this._sofort.shift();
          const res = onLocalContent(p, md.get(p));
          transport.write(clientId, p, res);
        }
        if (final || t - segStart >= rollTicks) {
          segStart = t;
          if (segFrames.length) { transport.seal(clientId, `.qollab/${clientId}/vseg-${segSeq}.qlb`); dateien++; segSeq++; segFrames = []; }
        }
      },
      async poll() {
        await this.onTick(transport.tick);
        if (this._eingang.length) {
          if (!doc) { doc = new Y.Doc(); adoptiert = true; }
          for (const u of this._eingang) Y.applyUpdate(doc, u);
          this._eingang.length = 0;
          adoptiert = true;
          // Nachtragen, was waehrend der Verweigerung nur in der Datei stand.
          for (const p of wartend.splice(0)) {
            const cur = textOf(p);
            setNote(p, cur === md.get(p) ? cur : R.unionMerge(cur, md.get(p)));
          }
          persist();
          for (const p of new Set([...md.keys()])) {
            const t = textOf(p);
            if (t !== md.get(p)) { md.set(p, t); transport.write(clientId, p, t); }
          }
        }
      },
      currentText: (p) => md.get(p) ?? '',
      stats: () => ({ dateien: dateien + 1 }),
    };
  });
}

// ===========================================================================
// S3 — inhaltsadressiertes ZUSTANDS-Log statt CRDT.
//
// Kein Yjs. Die Historie ist ein DAG aus Zustaenden; die Kennung eines Zustands
// ist der Hash SEINES TEXTES. Zwei Geraete, die denselben Text sehen, erzeugen
// damit zwangslaeufig denselben Knoten — es gibt nichts zu einigen. Der Merge
// ist ein 3-Wege-Merge (der ECHTE `threeWayMerge` aus text-merge.ts) gegen den
// tiefsten gemeinsamen Vorfahren, mit kanonisch sortierten Seiten, damit beide
// Geraete dieselbe Funktion rechnen.
// ===========================================================================
export function makeS3log(transport, scenario, { rollTicks = 900 } = {}) {
  return scenario.deviceIds.map((clientId) => {
    const md = new Map();
    const texte = new Map(); // stateId -> text  (im Echtbetrieb: Diffs)
    const eltern = new Map(); // stateId -> Set(stateId)
    const head = new Map(); // note -> stateId
    const basis = new Map(); // note -> zuletzt SAUBER gesehener Dateitext
    let segSeq = 0, segFrames = [], segStart = 0, dateien = 0, unverwandt = 0;
    const gesehen = new Set();

    const addNode = (t, parents) => {
      const id = sha(t);
      if (!texte.has(id)) texte.set(id, t);
      if (!eltern.has(id)) eltern.set(id, new Set());
      for (const p of parents) {
        if (p && p !== id && !eltern.get(id).has(p)) {
          eltern.get(id).add(p);
          tiefeMemo.clear(); // neue Kante -> alte Tiefen sind ungueltig
        }
      }
      return id;
    };
    const anc = (id) => {
      const out = new Set(), stack = [id];
      while (stack.length) {
        const x = stack.pop();
        if (out.has(x)) continue;
        out.add(x);
        for (const p of eltern.get(x) ?? []) stack.push(p);
      }
      return out;
    };
    // Tiefe iterativ (der DAG wird tief) und mit Zyklusschutz: derselbe Text kann
    // ueber verschiedene Wege erreicht werden, und ein Rueckschritt auf einen
    // frueheren Text erzeugt sonst eine Kante rueckwaerts.
    const tiefeMemo = new Map();
    const tiefe = (start) => {
      if (tiefeMemo.has(start)) return tiefeMemo.get(start);
      const stack = [[start, false]];
      const laufend = new Set();
      while (stack.length) {
        const [id, bearbeitet] = stack.pop();
        if (tiefeMemo.has(id)) continue;
        if (!bearbeitet) {
          laufend.add(id);
          stack.push([id, true]);
          for (const p of eltern.get(id) ?? []) {
            if (!tiefeMemo.has(p) && !laufend.has(p)) stack.push([p, false]);
          }
        } else {
          let d = 0;
          for (const p of eltern.get(id) ?? []) d = Math.max(d, 1 + (tiefeMemo.get(p) ?? 0));
          tiefeMemo.set(id, d);
          laufend.delete(id);
        }
      }
      return tiefeMemo.get(start) ?? 0;
    };
    const pack = (frames) => {
      let n = 0;
      for (const f of frames) n += 40 + f.text.length;
      const out = new Uint8Array(n);
      out.frames = frames.slice();
      return out;
    };
    const persist = (note, id) => {
      segFrames.push({ note, id, text: texte.get(id), parents: [...(eltern.get(id) ?? [])] });
      transport.write(clientId, `.qollab/${clientId}/log-${segSeq}.qlb`, pack(segFrames));
    };

    // Der Kern: einen Fremd-Head in den eigenen einarbeiten.
    const vereinige = (note, fremdId) => {
      const eigen = head.get(note);
      if (!eigen) { head.set(note, fremdId); return texte.get(fremdId); }
      if (eigen === fremdId) return texte.get(eigen);
      const aE = anc(eigen), aF = anc(fremdId);
      if (aF.has(eigen)) { head.set(note, fremdId); return texte.get(fremdId); }
      if (aE.has(fremdId)) return texte.get(eigen);
      const gemeinsam = [...aE].filter((x) => aF.has(x));
      let base;
      if (gemeinsam.length === 0) {
        unverwandt++;
        base = null;
      } else {
        base = gemeinsam.sort((a, b) => tiefe(b) - tiefe(a) || (a < b ? -1 : 1))[0];
      }
      // Kanonische Seitenwahl -> beide Geraete rechnen dieselbe Funktion.
      const [x, y] = [eigen, fremdId].sort();
      const res = base
        ? dreiWegeZeilen(texte.get(base), texte.get(x), texte.get(y))
        : R.unionMerge(texte.get(x), texte.get(y));
      const neu = addNode(res, [eigen, fremdId]);
      head.set(note, neu);
      persist(note, neu);
      return res;
    };

    const onLocalContent = (note, inhalt) => {
      if (!head.has(note)) {
        // GENESIS auf dem zuletzt SAUBER gesehenen Dateistand — nicht auf dem
        // Text nach der eigenen Eingabe. Beide Geraete haben dieselbe Datei vom
        // Sync bekommen, also ist dieser Knoten auf beiden Seiten derselbe.
        const g = addNode(basis.get(note) ?? inhalt, []);
        head.set(note, g);
        persist(note, g);
      }
      const cur = texte.get(head.get(note));
      if (cur === inhalt) return inhalt;
      const id = addNode(inhalt, [head.get(note)]);
      head.set(note, id);
      persist(note, id);
      return inhalt;
    };

    return {
      id: clientId,
      seedFile: (p, t) => { md.set(p, t); basis.set(p, t); },
      async userEdit(path, token, pos) {
        const neu = insertLine(md.get(path) ?? '', token, pos);
        md.set(path, neu);
        const f = onLocalContent(path, neu);
        md.set(path, f);
        transport.write(clientId, path, f);
      },
      receiveFile(path, bytes) {
        if (path.endsWith('.md')) {
          // Der Dateistand kommt vom Sync — er ist ein SAUBER gesehener Zustand.
          md.set(path, bytes);
          basis.set(path, bytes);
          this._sofort.push(path);
          return;
        }
        for (const f of bytes.frames ?? []) {
          const key = `${f.note}|${f.id}`;
          if (gesehen.has(key)) continue;
          gesehen.add(key);
          this._eingang.push(f);
        }
      },
      _sofort: [], _eingang: [],
      async onTick(t, final) {
        while (this._sofort.length) {
          const p = this._sofort.shift();
          const res = onLocalContent(p, md.get(p));
          md.set(p, res);
          transport.write(clientId, p, res);
        }
        if (final || t - segStart >= rollTicks) {
          segStart = t;
          if (segFrames.length) { transport.seal(clientId, `.qollab/${clientId}/log-${segSeq}.qlb`); dateien++; segSeq++; segFrames = []; }
        }
      },
      async poll() {
        await this.onTick(transport.tick);
        if (!this._eingang.length) return;
        const proNote = new Map();
        for (const f of this._eingang) {
          addNode(f.text, f.parents);
          if (!proNote.has(f.note)) proNote.set(f.note, []);
          proNote.get(f.note).push(f.id);
        }
        this._eingang.length = 0;
        for (const [note, ids] of proNote) {
          let res = null;
          for (const id of ids.sort((a, b) => tiefe(a) - tiefe(b))) res = vereinige(note, id);
          if (res !== null && res !== md.get(note)) {
            md.set(note, res);
            basis.set(note, res);
            transport.write(clientId, note, res);
          }
        }
      },
      currentText: (p) => md.get(p) ?? '',
      stats: () => ({ dateien: dateien + 1, unverwandt }),
    };
  });
}
