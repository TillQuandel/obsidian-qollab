// Minimaler Obsidian-Stub für Tests. Nur die von src/ real genutzten
// Klassen/Werte — nicht die ganze Obsidian-API. Wird via
// moduleNameMapper (^obsidian$) in package.json eingehängt.

class TFile {
  constructor(path = '', name = '') {
    this.path = path;
    this.name = name;
    this.stat = { mtime: 0, ctime: 0, size: 0 };
  }
}

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this._data = null;
  }
  registerEvent(eventRef) {
    return eventRef;
  }
  addSettingTab(_tab) {}
  async loadData() {
    return this._data;
  }
  async saveData(data) {
    this._data = data;
  }
}

class Notice {
  constructor(_message) {}
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      empty() {},
      createEl() {
        return {};
      },
    };
  }
}

class Setting {
  constructor(_containerEl) {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addToggle(cb) {
    const toggle = {
      setValue() {
        return toggle;
      },
      onChange() {
        return toggle;
      },
    };
    cb(toggle);
    return this;
  }
}

module.exports = { TFile, Plugin, Notice, PluginSettingTab, Setting };
