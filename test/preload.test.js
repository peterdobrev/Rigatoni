const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("the preload exposes specific operations and subscriptions can be removed", async () => {
  const sent = [], invoked = [];
  let api;
  const ipcRenderer = new EventEmitter();
  ipcRenderer.send = (...args) => sent.push(args);
  ipcRenderer.invoke = (...args) => { invoked.push(args); return Promise.resolve({ interval: 20 }); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer,
    }),
  });
  assert.equal(api.send, undefined);
  assert.equal(api.invoke, undefined);
  api.setSettings({ sound: false });
  api.remindNow();
  api.resizeCard(200);
  api.snooze();
  api.hideCard();
  assert.deepEqual(sent.map(([channel]) => channel), ["set", "remind:now", "card:resize", "card:snooze", "card:hidden"]);
  await api.getState();
  await api.completeExercise("chin");
  assert.deepEqual(invoked.map(([channel]) => channel), ["state:get", "card:done"]);
  let received;
  const unsubscribe = api.onState(value => { received = value; });
  ipcRenderer.emit("state", { secret: true }, { paused: true });
  assert.deepEqual(received, { paused: true });
  unsubscribe();
  ipcRenderer.emit("state", {}, { paused: false });
  assert.equal(received.paused, true);
  assert.equal(ipcRenderer.listenerCount("state"), 0);
});
