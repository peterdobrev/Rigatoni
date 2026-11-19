const $ = id => document.getElementById(id);
const hero = makeToni(); $("hero").appendChild(hero);
let state = null, clockTimer = null;

function showPose(p) {
  setPose(hero, p);
  $("pose-pill").textContent = POSES.find(x => x[0] === p)[1];
  [...$("poses").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.p === p));
}
POSES.forEach(([p, label]) => {
  const b = document.createElement("button");
  b.textContent = label; b.dataset.p = p; b.onclick = () => showPose(p);
  $("poses").appendChild(b);
});
showPose("wave");
setTimeout(() => showPose("idle"), 2600);

const fmtClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };

function render() {
  if (!state) return;
  $("interval").value = String(state.interval);
  $("sound").textContent = "Sound: " + (state.sound ? "on" : "off");
  $("pause").textContent = state.paused ? "Resume" : "Pause";
  $("login").checked = state.openAtLogin;
  $("login").disabled = !state.loginSupported;
  $("login").title = state.loginSupported ? "" : "Available in the packaged app.";
  $("login-label").textContent = state.platform === "darwin" ? "Start Toni at login" : "Start Toni when Windows starts";
  const n = state.stats.total;
  $("stats").textContent = n ? `${n} stretch${n === 1 ? "" : "es"} today` : "No stretches yet today.";
  tick();
}

function tick() {
  if (!state) return;
  if (state.paused) { $("clock-label").textContent = "Paused"; $("clock").textContent = fmtClock(state.pausedLeft); return; }
  $("clock-label").textContent = "Next stretch in";
  $("clock").textContent = state.nextAt ? fmtClock(state.nextAt - Date.now()) : "now";
}

toni.onVisibility(awake => {
  document.documentElement.classList.toggle("asleep", !awake);
  clearInterval(clockTimer);
  clockTimer = awake ? setInterval(tick, 1000) : null;
  if (awake) tick();
});
toni.onState(s => { state = s; render(); });
toni.getState().then(s => { state = s; render(); });

$("now").onclick = () => toni.remindNow();
$("pause").onclick = () => { if (state) toni.setSettings({ paused: !state.paused }); };
$("interval").onchange = e => toni.setSettings({ interval: Number(e.target.value) });
$("sound").onclick = () => { if (state) toni.setSettings({ sound: !state.sound }); };
$("login").onchange = e => toni.setSettings({ openAtLogin: e.target.checked });
