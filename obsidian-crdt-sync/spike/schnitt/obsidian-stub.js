// Minimaler Ersatz fuer das `obsidian`-Modul, damit der Produktionscode ausserhalb
// von Obsidian gebundelt und in Node ausgefuehrt werden kann. Nur das, was
// sync-handler/crdt-manager/vault-mock tatsaechlich anfassen.
class TFile {
  constructor() {
    this.path = '';
    this.name = '';
    this.stat = { mtime: 0, ctime: 0, size: 0 };
  }
}
class TFolder {}
class Notice {}
class Plugin {}
class PluginSettingTab {}
class Setting {}
module.exports = { TFile, TFolder, Notice, Plugin, PluginSettingTab, Setting };
