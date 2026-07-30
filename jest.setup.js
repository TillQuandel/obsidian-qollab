// Minimaler Obsidian-Stub für Tests. Nur die von src/ real genutzten
// Klassen/Werte — nicht die ganze Obsidian-API. Wird via
// moduleNameMapper (^obsidian$) in package.json eingehängt.

// Obsidian läuft in Electron, wo window === globalThis. In der node-Test-Umgebung
// gibt es kein window; main.ts nutzt window.setInterval für den Poll-Timer. Ein
// No-op-Shim (setInterval → 0) verhindert echte Timer-Handles, die den Jest-Lauf
// offenhalten würden — die Watcher-Tests rufen poll()/scanNote() ohnehin direkt.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    setInterval: () => 0,
    clearInterval: () => {},
  };
}

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
  registerInterval(id) {
    return id;
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
  // Task 14: Meldungen mitschneiden, damit Tests eine (einmalige) Notice
  // assertieren können. Tests, die das nutzen, leeren die Liste selbst.
  constructor(message) {
    Notice.messages.push(message);
  }
}
Notice.messages = [];

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
  constructor(_containerEl) {
    this._name = '';
  }
  setName(name) {
    this._name = name;
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    return this;
  }
  // Task 17/F-5: Der registrierte onChange-Handler wird mitgeschnitten, damit ein
  // Test den Schalter wirklich umlegen kann statt nur `settings.enabled` zu
  // setzen — die Logik, die am Wechsel hängt, sitzt genau in diesem Handler.
  addToggle(cb) {
    const toggle = {
      _value: undefined,
      _onChange: undefined,
      setValue(v) {
        toggle._value = v;
        return toggle;
      },
      onChange(fn) {
        toggle._onChange = fn;
        return toggle;
      },
    };
    cb(toggle);
    Setting.toggles.push({ name: this._name, toggle });
    return this;
  }
}
Setting.toggles = [];

module.exports = { TFile, Plugin, Notice, PluginSettingTab, Setting };
