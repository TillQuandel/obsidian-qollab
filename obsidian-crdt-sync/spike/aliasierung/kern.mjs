// kern.mjs — der Messapparat der Aliasierungs-Sonde. Harness-frei: er fuehrt
// ausschliesslich die beiden echten Produktivfunktionen aus, die der
// Inkarnationswechsel benutzt.
//
// NACHGEBAUT WIRD `switchToGuid` (`src/sync-handler.ts:1375-1455`), und zwar nur
// sein Schluss ab :1443:
//
//   :1443  const winnerText = this.crdtManager.getContent(notePath);
//   :1444  if (winnerText === localText) return;
//   :1454  this.crdtManager.setContent(notePath, this.unite(notePath, winnerText, localText));
//
// `unite` (:601-605) ist `unionMerge` plus einer Meldung — funktional also
// `unionMerge(other, local)` (`src/text-merge.ts:362`). `setContent` ist der
// echte (`src/crdt-manager.ts:364`), im Standardmodus `zeile`.
//
// DIE MESSGROESSE — „eigene Kopie" wird auf ITEM-Ebene gelesen, nicht ueber
// Zeilenzaehlung: Nach dem Wechsel traegt der Verlierer-Doc die Items des
// Gewinners (uebernommen per `applyUpdate`) und genau die Items, die sein
// eigenes `setContent` frisch einfuegt. Fuer jede Zeile des Endtextes wird
// deshalb ausgelesen, WELCHE clientID ihre Zeichen besitzt:
//
//   EIGEN     mindestens ein Zeichen der Zeile gehoert dem Verlierer
//   ALIAS     alle Zeichen gehoeren dem Gewinner — der lokale Beitrag haengt an
//             einem fremden Item
//
// Die Probe darauf: Der Gewinner loescht anschliessend SEINE Zeile (auf seinem
// eigenen Doc, per `setContent` ohne diese Zeile — also eine Delete-Op auf
// seinen eigenen Items). Danach werden beide Staende zusammengefuehrt. Steht die
// Zeile noch da, hatte der lokale Beitrag eine eigene Kopie.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unionMerge, CrdtManager } = require('./real-alias.cjs');

export const DET = Number(process.env.SPIKE_DET ?? 42);
const PFAD = 'Notiz.md';

// clientIDs deterministisch aus SPIKE_DET. Sie stehen fest, BEVOR die erste Op
// faellt — `encodeState` legt den Doc an, ohne ihn zu beschreiben.
function manager(clientId) {
  const m = new CrdtManager();
  m.encodeState(PFAD);
  m.docs.get(PFAD).clientID = clientId;
  return m;
}

// Zeilen des Doc-Textes mit den clientIDs, denen ihre Zeichen gehoeren.
// Gelaufen wird die Item-Liste von `Y.Text`, nicht der String — nur so ist
// „eigenes Item" vom blossen Zeichenvergleich zu unterscheiden.
function zeilenBesitz(doc) {
  const einheiten = [];
  let item = doc.getText('content')._start;
  while (item) {
    if (!item.deleted) {
      const s = item.content?.str;
      if (typeof s === 'string') {
        for (let i = 0; i < s.length; i++) einheiten.push([s[i], item.id.client]);
      }
    }
    item = item.right;
  }
  const zeilen = [];
  let text = '';
  let clients = new Set();
  for (const [ch, client] of einheiten) {
    clients.add(client);
    if (ch === '\n') {
      zeilen.push({ text, clients });
      text = '';
      clients = new Set();
    } else {
      text += ch;
    }
  }
  if (text.length > 0) zeilen.push({ text, clients });
  return zeilen;
}

const zaehle = (t, z) => t.split('\n').filter((x) => x === z).length;

// Ein Fall: Gewinnertext, lokaler Text, und die Zeile, um die es geht.
// `marke` muss in BEIDEN Texten vorkommen (sonst ist die Frage nach der
// Aliasierung gegenstandslos) und im Gewinnertext genau einmal.
export function fall(name, winnerText, localText, marke) {
  const G_ID = DET * 2 + 1;
  const V_ID = DET * 2 + 2;

  // Gewinner-Doc: der Text als seine eigenen Ops.
  const G = manager(G_ID);
  G.setContent(PFAD, winnerText);
  const gewState = G.encodeState(PFAD);

  // :1443/:1444 — Kurzschluss bei Gleichheit.
  const ziel = unionMerge(winnerText, localText); // = `unite` an :1454
  const kurzschluss = winnerText === localText;

  // Verlierer: Historie verworfen, Gewinner-Doc uebernommen, Vereinigung
  // materialisiert.
  const V = manager(V_ID);
  V.applyUpdate(PFAD, gewState);
  if (!kurzschluss) V.setContent(PFAD, ziel);
  const vDoc = V.docs.get(PFAD);
  const besitz = zeilenBesitz(vDoc);

  // Vorkommen der Marke im Endstand des Verlierers, je mit Besitzer.
  const vorkommen = besitz
    .map((z, i) => ({ i, ...z }))
    .filter((z) => z.text === marke)
    .map((z) => ({ zeile: z.i, eigen: z.clients.has(V_ID) }));
  const eigeneKopie = vorkommen.some((v) => v.eigen);

  // marke === null: nur die Besitzkarte, keine Loeschprobe (fuer Faelle, in
  // denen die interessante Zeile die Leerzeile ist und `indexOf` nicht traegt).
  if (marke === null) {
    return {
      name,
      marke,
      winnerText,
      localText,
      ziel,
      imGewinner: 0,
      imLokalen: 0,
      imZiel: 0,
      vorkommen: [],
      eigeneKopie: null,
      nachLoeschung: null,
      ueberlebt: null,
      besitz: besitz.map((z) => ({ text: z.text, eigen: z.clients.has(V_ID) })),
    };
  }

  // Der Gewinner loescht SEINE Zeile — auf seinem eigenen Doc, also eine
  // Delete-Op auf seinen eigenen Items. Er hat den Verliererstand dabei noch
  // nicht gesehen; das ist die kausal ungefaehrlichste Variante.
  const ohne = winnerText
    .split('\n')
    .filter((z, i, a) => !(z === marke && a.indexOf(z) === i))
    .join('\n');
  G.setContent(PFAD, ohne);
  const gewLoeschState = G.encodeState(PFAD);

  // Zusammenfuehren beider Staende (Reihenfolge egal, CRDT).
  const Z = manager(G_ID + 1000);
  Z.applyUpdate(PFAD, gewLoeschState);
  Z.applyUpdate(PFAD, V.encodeState(PFAD));
  const nachLoeschung = Z.getContent(PFAD);
  const ueberlebt = zaehle(nachLoeschung, marke) > 0;

  return {
    name,
    marke,
    winnerText,
    localText,
    ziel,
    imGewinner: zaehle(winnerText, marke),
    imLokalen: zaehle(localText, marke),
    imZiel: zaehle(ziel, marke),
    vorkommen,
    eigeneKopie,
    nachLoeschung,
    ueberlebt,
    besitz: besitz.map((z) => ({ text: z.text, eigen: z.clients.has(V_ID) })),
  };
}

export function zeigeKurz(r) {
  const kopie = r.eigeneKopie ? 'EIGENE KOPIE' : 'ALIAS       ';
  const leben = r.ueberlebt ? 'ueberlebt' : 'TOT      ';
  console.log(
    `  ${r.name.padEnd(46)} | Gew ${r.imGewinner}x  Lok ${r.imLokalen}x  Ziel ${r.imZiel}x | ${kopie} | ${leben}`
  );
}

export function zeigeLang(r) {
  console.log(`--- ${r.name}`);
  console.log(`  winner : ${JSON.stringify(r.winnerText)}`);
  console.log(`  local  : ${JSON.stringify(r.localText)}`);
  console.log(`  ziel   : ${JSON.stringify(r.ziel)}`);
  console.log(`  Marke "${r.marke}": Gewinner ${r.imGewinner}x, lokal ${r.imLokalen}x, Ziel ${r.imZiel}x`);
  for (const v of r.vorkommen) {
    console.log(`     Vorkommen an Zeile ${v.zeile}: ${v.eigen ? 'EIGENES Item (Verlierer)' : 'FREMDES Item (Gewinner) <- aliasiert'}`);
  }
  console.log(`  Besitzkarte des Verlierer-Docs (E = eigenes Item):`);
  for (const z of r.besitz) console.log(`     ${z.eigen ? 'E' : '.'}  ${JSON.stringify(z.text)}`);
  console.log(`  Gewinner loescht "${r.marke}" auf seinem Doc -> Endstand:`);
  console.log(`     ${JSON.stringify(r.nachLoeschung)}`);
  console.log(`  Beitrag ${r.ueberlebt ? 'UEBERLEBT' : 'TOT'}`);
  console.log('');
}
