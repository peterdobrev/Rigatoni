const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "main.js"), "utf8");

async function createApp({ settings, platform = "darwin", packaged = true, argv = [], load = true } = {}) {
  let now = Date.parse("2026-11-19T12:00:00Z");
  const windows = [], intervals = [], writes = [], loginChanges = [];
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.visible = false;
      this.minimized = false;
      this.focused = false;
      this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: "" };
      this.webContents.send = (channel, data) => this.messages.push([channel, structuredClone(data)]);
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      windows.push(this);
    }
    loadFile(file) { this.file = file; this.webContents.mainFrame.url = pathToFileURL(file).href; }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isFocused() { return this.focused; }
    show() { this.visible = true; this.emit("show"); }
    showInactive() { this.show(); }
    hide() { this.visible = false; this.emit("hide"); }
    focus() { this.focused = true; this.emit("focus"); }
    restore() { this.minimized = false; this.emit("restore"); }
    setAlwaysOnTop() {}
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = bounds; }
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
  }
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: packaged,
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    getPath: () => "/virtual/toni",
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: options => loginChanges.push(options),
    whenReady: () => Promise.resolve(),
    quit() {},
  });
  const powerMonitor = new EventEmitter();
  const electron = {
    app, BrowserWindow: Window, Tray, ipcMain, powerMonitor,
    Menu: { buildFromTemplate: menu => menu },
    screen: {
      getCursorScreenPoint: () => ({ x: 10, y: 10 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    },
    nativeImage: { createFromPath: file => file },
  };
  vm.runInNewContext(`(function () { ${source}\n})()`, {
    require: name => {
      if (name === "electron") return electron;
      if (name === "fs") return {
        readFileSync: () => settings,
        writeFileSync: (_file, value) => writes.push(JSON.parse(value)),
      };
      return require(name);
    },
    __dirname: root,
    process: { platform, argv: ["electron", root, ...argv], execPath: "/virtual/electron" },
    Date: Clock,
    setInterval: (callback, ms) => intervals.push({ callback, ms }),
  });
  await Promise.resolve();
  const card = windows.find(win => win.file.endsWith("card.html"));
  const main = windows.find(win => win.file.endsWith("app.html"));
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  const invoke = (channel, data, win = main) => handlers.get(channel)(event(win), data);
  const send = (channel, data, win = main) => ipcMain.emit(channel, event(win), data);
  const loaded = win => { win.webContents.emit("did-finish-load"); win.emit("ready-to-show"); };
  if (load) { loaded(card); loaded(main); }
  return {
    app, main, card, ipcMain, handlers, event, invoke, send, loaded, powerMonitor, loginChanges, writes,
    state: () => invoke("state:get"),
    now: () => now,
    advance: ms => { now += ms; },
    tick: () => intervals.find(interval => interval.ms === 1000).callback(),
  };
}

test("changing the interval preserves pause and resumes with the new duration", async () => {
  const app = await createApp();
  app.advance(60000);
  app.send("set", { paused: true });
  assert.equal(app.state().pausedLeft, 19 * 60000);
  assert.equal(app.state().nextAt, 0);
  app.send("set", { interval: 30 });
  app.advance(60 * 60000);
  app.tick();
  assert.equal(app.card.visible, false);
  assert.equal(app.state().paused, true);
  assert.equal(app.state().pausedLeft, 30 * 60000);
  app.send("set", { paused: false });
  assert.equal(app.state().nextAt, app.now() + 30 * 60000);
});

test("pausing an open reminder survives completion and dismissal", async () => {
  const app = await createApp();
  app.send("remind:now");
  app.send("set", { paused: true });
  assert.equal(app.state().paused, true);
  app.invoke("card:done", "chin", app.card);
  app.send("card:hidden", undefined, app.card);
  app.advance(60 * 60000);
  app.tick();
  assert.equal(app.card.visible, false);
  assert.equal(app.state().nextAt, 0);
  assert.equal(app.state().pausedLeft, 20 * 60000);
});

test("a snoozed reminder stays paused until explicitly resumed", async () => {
  const app = await createApp();
  app.send("set", { paused: true });
  app.send("remind:now");
  app.send("card:snooze", undefined, app.card);
  app.send("card:hidden", undefined, app.card);
  app.advance(10 * 60000);
  app.tick();
  assert.equal(app.state().pausedLeft, 5 * 60000);
  assert.equal(app.card.visible, false);
  app.send("set", { paused: false });
  assert.equal(app.state().nextAt, app.now() + 5 * 60000);
});

test("reminders requested before the card loads are delivered once it is ready", async () => {
  const app = await createApp({ argv: ["--remind-now"], load: false });
  app.send("remind:now");
  assert.equal(app.card.visible, false);
  app.loaded(app.card);
  assert.equal(app.card.visible, true);
  const reminders = app.card.messages.filter(([channel]) => channel === "card:show");
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0][1].index, 0);
});

test("completed reminders are counted only once and invalid exercise IDs are ignored", async () => {
  const app = await createApp();
  app.invoke("card:done", "chin", app.card);
  assert.equal(app.state().stats.total, 0);
  app.send("remind:now");
  app.invoke("card:done", "__proto__", app.card);
  assert.equal(app.state().stats.total, 0);
  app.invoke("card:done", "chin", app.card);
  app.invoke("card:done", "chin", app.card);
  assert.equal(app.state().stats.total, 1);
  assert.equal(app.state().stats.by.chin, 1);
});

test("IPC rejects other windows, subframes and navigated pages", async () => {
  const app = await createApp();
  app.send("set", { interval: 1 }, app.card);
  assert.equal(app.state().interval, 20);
  assert.throws(() => app.invoke("card:done", "chin"), /Untrusted sender/);
  app.ipcMain.emit("set", { ...app.event(app.main), senderFrame: { url: app.main.webContents.mainFrame.url } }, { interval: 1 });
  assert.equal(app.state().interval, 20);
  app.main.webContents.mainFrame.url = "https://example.com";
  app.send("set", { interval: 1 });
  assert.throws(() => app.state(), /Untrusted sender/);
  assert.equal(app.main.openHandler().action, "deny");
  let prevented = false;
  app.main.webContents.emit("will-navigate", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("settings and window sizes reject malformed renderer input", async () => {
  const app = await createApp();
  for (const settings of [null, [], 5, { interval: 0, sound: "yes", paused: 1, openAtLogin: "yes" }]) app.send("set", settings);
  assert.equal(app.state().interval, 20);
  assert.equal(app.state().sound, true);
  assert.equal(app.state().paused, false);
  assert.equal(app.loginChanges.length, 0);
  app.send("card:resize", NaN, app.card);
  assert.equal(app.card.getBounds().height, 180);
  app.send("card:resize", 100000, app.card);
  assert.equal(app.card.getBounds().height, 900);
  app.send("card:resize", -1, app.card);
  assert.equal(app.card.getBounds().height, 100);
});

test("invalid saved settings cannot break startup or pollute exercise statistics", async () => {
  const saved = {
    interval: -20, sound: "false", index: -1,
    stats: { day: new Date("2026-11-19T12:00:00Z").toDateString(), total: -1, by: { chin: 2, neck: -1, unknown: 10 } },
  };
  const app = await createApp({ settings: JSON.stringify(saved) });
  assert.equal(app.state().interval, 20);
  assert.equal(app.state().sound, true);
  assert.equal(app.state().stats.total, 0);
  assert.equal(app.state().stats.by.chin, 2);
  assert.equal(app.state().stats.by.neck, undefined);
  assert.equal(app.state().stats.by.unknown, undefined);
  app.send("remind:now");
  assert.equal(app.card.messages.find(([channel]) => channel === "card:show")[1].index, 0);
  for (const settings of ["null", "{broken", "[]"]) assert.equal((await createApp({ settings })).state().interval, 20);
});

test("wake resets active deadlines but leaves paused reminders untouched", async () => {
  const app = await createApp();
  app.advance(10 * 60000);
  app.powerMonitor.emit("resume");
  assert.equal(app.state().nextAt, app.now() + 20 * 60000);
  app.send("set", { paused: true });
  app.advance(60 * 60000);
  app.powerMonitor.emit("unlock-screen");
  assert.equal(app.state().nextAt, 0);
  assert.equal(app.state().pausedLeft, 20 * 60000);
});

test("midnight publishes reset statistics even while paused", async () => {
  const app = await createApp();
  app.send("remind:now");
  app.invoke("card:done", "chin", app.card);
  app.send("card:hidden", undefined, app.card);
  app.send("set", { paused: true });
  app.advance(24 * 60 * 60000);
  app.tick();
  const latest = app.main.messages.filter(([channel]) => channel === "state").at(-1)[1];
  assert.equal(latest.stats.total, 0);
  assert.equal(latest.paused, true);
});

test("visibility updates follow focus for the main window but not the non-focusable card", async () => {
  const app = await createApp();
  app.main.focus();
  assert.deepEqual(app.main.messages.at(-1), ["visibility", true]);
  app.main.hide();
  assert.deepEqual(app.main.messages.at(-1), ["visibility", false]);
  app.send("remind:now");
  assert.equal(app.card.messages.some(([channel, awake]) => channel === "visibility" && awake), true);
  app.main.minimized = true;
  app.app.emit("activate");
  assert.equal(app.main.minimized, false);
  assert.equal(app.main.visible, true);
});

test("packaged macOS login settings omit executable paths and Windows keeps its arguments", async () => {
  const mac = await createApp();
  mac.send("set", { openAtLogin: true });
  assert.equal(mac.loginChanges[0].openAtLogin, true);
  assert.equal(mac.loginChanges[0].path, undefined);
  const windows = await createApp({ platform: "win32" });
  windows.send("set", { openAtLogin: true });
  assert.equal(windows.loginChanges[0].path, "/virtual/electron");
  assert.equal(windows.loginChanges[0].args[0], "--hidden");
  const development = await createApp({ packaged: false });
  development.send("set", { openAtLogin: true });
  assert.equal(development.state().loginSupported, false);
  assert.equal(development.loginChanges.length, 0);
});
