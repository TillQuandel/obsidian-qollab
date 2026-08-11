// Unabhaengige Nachpruefung der Widerlegung:
// Behauptung: Laesst das Gate eine lokale Zeile weg, WEIL der Gewinner-Doc
// dafuer schon ein Item traegt, dann haengt der lokale Beitrag danach an einem
// FREMDEN Item — und ein gewoehnlicher Delete auf dem Gewinner-Geraet toetet ihn.
import * as Y from 'yjs';

const winnerText = 'b0\nb3\nb2\n';
const localText  = 'b0\nb1\nA1\nb2\nb3\n';

// So wuerde `unite` (unionMerge) heute vereinigen — ohne Gate steht b3 zweimal
// im Ziel, einmal als Gewinner-Item, einmal als frische Op des Verlierers.
const zielOhneGate = 'b0\nb3\nb1\nA1\nb2\nb3\n';
// Mit dem zeilenweisen Gate faellt das zweite b3 weg, weil der Gewinner es hat.
const zielMitGate  = 'b0\nb3\nb1\nA1\nb2\n';

function lauf(name, ziel) {
  // Gewinner-Doc aufbauen (Client 1)
  const gew = new Y.Doc({ clientID: 1 });
  gew.getText('t').insert(0, winnerText);
  const gewState = Y.encodeStateAsUpdate(gew);

  // Verlierer-Geraet: uebernimmt den Gewinner-Doc, setzt dann `ziel` per Diff
  const ver = new Y.Doc({ clientID: 2 });
  Y.applyUpdate(ver, gewState);
  const t = ver.getText('t');
  // setContent-Ersatz: naiver Diff (loeschen + einfuegen der Differenz) waere
  // unfair. Wir bilden nur das ab, was zaehlt: die Ops fuer `ziel` entstehen
  // unter Client 2, soweit sie NICHT schon als Gewinner-Item existieren.
  t.delete(0, t.length);
  t.insert(0, ziel);
  const verState = Y.encodeStateAsUpdate(ver);

  // Gewinner-Geraet: sieht den Stand des Verlierers ...
  const gew2 = new Y.Doc({ clientID: 1 });
  Y.applyUpdate(gew2, gewState);
  Y.applyUpdate(gew2, verState);
  const vorher = gew2.getText('t').toString();

  // ... und loescht dann SEINE eigene Zeile b3 — ein ganz gewoehnlicher Edit,
  // der mit dem lokalen Beitrag des Verlierers nichts zu tun hat.
  const txt = gew2.getText('t');
  const s = txt.toString();
  const idx = s.indexOf('b3\n');
  if (idx >= 0) txt.delete(idx, 3);
  const nachher = gew2.getText('t').toString();

  const zaehl = (x, n) => x.split('\n').filter((z) => z === n).length;
  console.log(`--- ${name}`);
  console.log(`  ziel an setContent : ${JSON.stringify(ziel)}`);
  console.log(`  nach Zusammenfuehrung: ${JSON.stringify(vorher)}`);
  console.log(`  nach Gewinner-Delete: ${JSON.stringify(nachher)}`);
  console.log(`  b3 noch da?         : ${zaehl(nachher, 'b3') > 0 ? 'JA' : 'NEIN  <-- lokaler Beitrag tot'}`);
  console.log('');
  return zaehl(nachher, 'b3') > 0;
}

const a = lauf('OHNE Gate (heutiger Stand)', zielOhneGate);
const b = lauf('MIT zeilenweisem Gate', zielMitGate);
console.log(`URTEIL: ohne Gate b3 erhalten=${a} | mit Gate b3 erhalten=${b}`);
console.log(b === false && a === true
  ? 'WIDERLEGUNG BESTAETIGT — das Gate macht den lokalen Beitrag loeschbar.'
  : 'Widerlegung NICHT reproduziert.');
