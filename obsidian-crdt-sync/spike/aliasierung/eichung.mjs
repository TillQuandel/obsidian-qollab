// eichung.mjs — Gegenprobe des Apparats an den zwei Faellen, die die Vorlage
// `spike/gate-widerlegung/probe-head-aliasing.mjs` bereits belegt hat. Wenn der
// echte `setContent` dieselben zwei Ergebnisse liefert wie die dortige
// Grobmaterialisierung (delete-all + insert-all), misst diese Sonde dasselbe
// Phaenomen — nur feiner, naemlich auf Item-Ebene.
//
//   SPIKE_DET=42 node spike/aliasierung/eichung.mjs
import { fall, zeigeLang, DET } from './kern.mjs';

console.log(`== eichung  SPIKE_DET=${DET}`);
console.log('');

zeigeLang(fall('Vorlage 1 (Widerlegung: unionMerge verdoppelt)',
  'b0\nb3\nb2\n', 'b0\nb1\nA1\nb2\nb3\n', 'b3'));

zeigeLang(fall('Vorlage 2 (gemeinsame Zeile, gleiche Stelle)',
  '# Notiz\nnur auf C\ngemeinsam\n', '# Notiz\nnur auf A\ngemeinsam\n', 'gemeinsam'));
