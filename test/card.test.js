const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createCard() {
  const elements = new Map(), timeouts = new Map();
  let nextTimer = 0, reminder, hidden = 0;
  const element = () => ({
    hidden: false, children: [], style: {}, offsetHeight: 140,
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.children.push(child); },
  });
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element,
      documentElement: element(),
    },
    makeToni: element,
    setPose() {},
    chime() {},
    EXERCISES: [{ id: "chin", title: "Chin tucks", desc: "", reps: "", secs: 45, pose: "chin", steps: [] }],
    ResizeObserver: class { observe() {} },
    setTimeout(callback, ms) { const id = ++nextTimer; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval: () => 1,
    clearInterval() {},
    toni: {
      resizeCard() {}, onVisibility() {}, snooze() {},
      onReminder(callback) { reminder = callback; },
      completeExercise: async () => ({ total: 1, by: { chin: 1 } }),
      hideCard() { hidden++; },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "card.js"), "utf8"), context);
  return {
    show: () => reminder({ index: 0, sound: false, stats: { total: 0, by: {} } }),
    evaluate: expression => vm.runInContext(expression, context),
    hidden: () => hidden,
    fire(ms) {
      for (const [id, timer] of [...timeouts]) {
        if (timer.ms !== ms || !timeouts.has(id)) continue;
        timeouts.delete(id);
        timer.callback();
      }
    },
  };
}

test("snoozing a completed reminder cannot let its old dismissal hide the next reminder", async () => {
  const card = createCard();
  card.show();
  card.fire(2600);
  card.fire(300);
  card.evaluate("start()");
  await card.evaluate("done()");
  card.evaluate("snooze()");
  card.fire(460);
  assert.equal(card.hidden(), 1);
  card.show();
  card.fire(2600);
  card.fire(460);
  assert.equal(card.evaluate("phase"), "ex");
  assert.equal(card.hidden(), 1);
});

test("snoozing during a view transition cancels its pending pose and view changes", () => {
  const card = createCard();
  card.show();
  card.fire(2600);
  card.evaluate("snooze()");
  card.fire(300);
  card.fire(460);
  card.show();
  card.fire(300);
  assert.equal(card.evaluate("phase"), "intro");
  assert.equal(card.evaluate("document.getElementById('v-ex').hidden"), true);
});
