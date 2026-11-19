const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  await once(socket, "open");
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toni-smoke-"));
  const packaged = Boolean(process.argv[2]);
  const executable = packaged ? path.resolve(process.argv[2]) : require("electron");
  const child = spawn(executable, [
    ...(packaged ? [] : [root]), "--hidden", `--user-data-dir=${directory}`,
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise(resolve => child.once("exit", resolve));
  const clients = [];
  let stderr = "";
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Electron did not start: ${stderr}`)), 20000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.stderr.on("data", chunk => {
        stderr = (stderr + chunk).slice(-16000);
        const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      child.once("exit", code => {
        clearTimeout(timeout);
        reject(new Error(`Electron exited (${code}): ${stderr}`));
      });
    });
    const pages = await waitFor(async () => {
      const response = await fetch(`${endpoint}/json/list`);
      const targets = await response.json();
      const main = targets.find(target => target.url.endsWith("/src/app.html"));
      const card = targets.find(target => target.url.endsWith("/src/card.html"));
      return main && card ? { main, card } : null;
    }, "both renderer windows");
    const main = await connect(pages.main.webSocketDebuggerUrl);
    clients.push(main);
    const card = await connect(pages.card.webSocketDebuggerUrl);
    clients.push(card);
    await waitFor(() => evaluate(main, "typeof toni === 'object' && document.querySelectorAll('.poses button').length === 7"), "main UI");
    await waitFor(() => evaluate(card, "typeof toni === 'object' && document.querySelector('#thumb svg') !== null"), "reminder UI");
    assert.equal(await evaluate(main, "typeof require"), "undefined");
    assert.equal(await evaluate(main, "typeof toni.send"), "undefined");
    assert.equal(await evaluate(main, "clockTimer === null && document.documentElement.classList.contains('asleep')"), true);
    const initial = await evaluate(main, "toni.getState()");
    assert.equal(initial.stats.total, 0);
    await evaluate(main, "toni.setSettings({ sound: false }); toni.remindNow()");
    await waitFor(() => evaluate(card, "!document.getElementById('v-ex').hidden"), "exercise controls");
    await evaluate(main, "toni.setSettings({ paused: true }); toni.setSettings({ interval: 30 })");
    await evaluate(card, "document.querySelector('#foot-btns button').click()");
    await evaluate(card, "document.querySelector('#foot-btns button').click()");
    await waitFor(() => evaluate(main, "toni.getState().then(state => state.stats.total === 1)"), "completed exercise");
    await evaluate(card, "toni.completeExercise('chin')");
    assert.equal((await evaluate(main, "toni.getState()")).stats.total, 1);
    await waitFor(() => evaluate(card, "phase === 'hidden'"), "completed reminder dismissal");
    const paused = await evaluate(main, "toni.getState()");
    assert.equal(paused.paused, true);
    assert.equal(paused.nextAt, 0);
    assert.equal(paused.pausedLeft, 30 * 60000);
    await evaluate(main, "toni.setSettings({ paused: false }); toni.remindNow()");
    await waitFor(() => evaluate(card, "phase === 'intro'"), "second reminder");
    await evaluate(card, "document.getElementById('close').click()");
    await waitFor(() => evaluate(card, "phase === 'hidden'"), "snoozed reminder dismissal");
    const snoozed = await evaluate(main, "toni.getState()");
    assert.equal(snoozed.paused, false);
    assert.ok(snoozed.nextAt - Date.now() > 290000 && snoozed.nextAt - Date.now() <= 300000);
    assert.equal(await evaluate(main, "window.open('https://example.com') === null"), true);
    assert.equal(await evaluate(main, "toni.completeExercise('chin').then(() => false, () => true)"), true);
    console.log(`Electron smoke test passed (${packaged ? "packaged app" : "development app"}).`);
  } finally {
    for (const client of clients) client.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timeout);
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
