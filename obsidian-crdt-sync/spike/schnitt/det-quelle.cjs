var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../zufall-quelle.ts
var zufall_quelle_exports = {};
__export(zufall_quelle_exports, {
  seedAusKonfig: () => seedAusKonfig,
  setzeZufallSeed: () => setzeZufallSeed,
  zufallQuelleAn: () => zufallQuelleAn,
  zufallQuelleAus: () => zufallQuelleAus
});
module.exports = __toCommonJS(zufall_quelle_exports);
var webcrypto = require("lib0/webcrypto");
var echt = webcrypto.getRandomValues;
var zustand = 1;
function naechste() {
  zustand = zustand + 1831565813 | 0;
  let t = zustand;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return (t ^ t >>> 14) >>> 0;
}
function setzeZufallSeed(seed) {
  zustand = (seed | 0) === 0 ? 1 : seed | 0;
}
function zufallQuelleAn() {
  webcrypto.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = naechste();
    return arr;
  };
}
function zufallQuelleAus() {
  if (echt) webcrypto.getRandomValues = echt;
}
function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var OFFSET = Number(process.env.SPIKE_SEED_OFFSET ?? 0);
function seedAusKonfig(k) {
  return OFFSET + fnv1a(
    JSON.stringify([
      k.szenario,
      k.editfall,
      k.reihenfolge,
      k.aWinnt,
      k.konfliktModus,
      k.sperreBis,
      !!k.externEdit
    ])
  ) >>> 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  seedAusKonfig,
  setzeZufallSeed,
  zufallQuelleAn,
  zufallQuelleAus
});
