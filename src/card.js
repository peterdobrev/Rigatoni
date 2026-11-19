const $ = id => document.getElementById(id);
const thumb = makeToni(); $("thumb").appendChild(thumb);
const card = $("card");
let ex = null, phase = "hidden", timer = null, runStart = 0, data = null;
let introTimer = null, poseTimer = null, fadeTimer = null, doneTimer = null, hideTimer = null;

const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

new ResizeObserver(() => toni.resizeCard(card.offsetHeight + 40)).observe(card);
toni.onVisibility(awake => document.documentElement.classList.toggle("asleep", !awake));

function swapView(from, to) {
  from.classList.add("fade");
  poseTimer = setTimeout(() => {
    from.hidden = true; from.classList.remove("fade");
    to.hidden = false; to.classList.add("fade"); void to.offsetWidth;
    fadeTimer = setTimeout(() => to.classList.remove("fade"), 20);
    setPose(thumb, ex.pose);
  }, 300);
}

function footer(btns) {
  const box = $("foot-btns"); box.innerHTML = "";
  btns.forEach(([label, fn, cls]) => {
    const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; box.appendChild(b);
  });
}

function fillExercise() {
  $("ex-title").textContent = ex.title;
  const n = data.stats.by[ex.id] || 0;
  $("ex-count").textContent = n ? `${n} today` : "";
  $("ex-desc").textContent = ex.desc;
  $("ex-reps").textContent = ex.reps;
  $("steps").innerHTML = ex.steps.map(s => `<li>${s}</li>`).join("");
  $("steps").hidden = true;
  $("ex-time").textContent = ex.secs >= 60 ? `${ex.secs / 60} min` : `${ex.secs} sec`;
  $("bar").style.width = "0"; $("bar").classList.remove("ok");
  footer([["Start", start, "dark"], ["Snooze", snooze]]);
}

function clearTransitions() {
  for (const timeout of [introTimer, poseTimer, fadeTimer, doneTimer, hideTimer]) clearTimeout(timeout);
}

toni.onReminder(d => {
  clearTransitions();
  data = d; ex = EXERCISES[d.index % EXERCISES.length]; phase = "intro";
  clearInterval(timer);
  fillExercise();
  $("v-intro").hidden = false; $("v-ex").hidden = true;
  $("v-intro").classList.remove("fade"); $("v-ex").classList.remove("fade");
  setPose(thumb, "wave");
  card.classList.remove("show", "leaving"); void card.offsetWidth;
  card.classList.add("show");
  if (d.sound) chime();
  introTimer = setTimeout(() => {
    if (phase !== "intro") return;
    phase = "ex";
    swapView($("v-intro"), $("v-ex"));
  }, 2600);
});

function start() {
  if (phase !== "ex") return;
  phase = "run"; runStart = Date.now();
  setPose(thumb, ex.pose);
  footer([["Done", done, "dark wide"], ["Stop", stop]]);
  clearInterval(timer);
  const step = () => {
    const el = Date.now() - runStart, total = ex.secs * 1000;
    $("bar").style.width = Math.min(100, el / total * 100) + "%";
    $("ex-time").textContent = `${fmt(total - el)} left`;
    if (el >= total) done();
  };
  step(); timer = setInterval(step, 250);
}

function stop() { clearInterval(timer); phase = "ex"; fillExercise(); }

async function done() {
  if (phase !== "run") return;
  clearInterval(timer); phase = "done";
  const stats = await toni.completeExercise(ex.id);
  if (phase !== "done") return;
  $("bar").classList.add("ok"); $("bar").style.width = "100%";
  $("foot-btns").innerHTML = `<div class="ex-done"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6 10.4 L8.8 13 L14 7.4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Nice! That's ${stats.total} today.</div>`;
  $("ex-time").textContent = "";
  $("ex-count").textContent = `${stats.by[ex.id]} today`;
  setPose(thumb, "thumbs");
  if (data.sound) chime([660, 880, 1175]);
  doneTimer = setTimeout(hide, 2600);
}

function snooze() {
  if (phase === "hidden" || phase === "leaving") return;
  toni.snooze(); hide();
}

function hide() {
  clearInterval(timer); clearTransitions();
  phase = "leaving";
  card.classList.add("leaving");
  hideTimer = setTimeout(() => {
    card.classList.remove("show", "leaving"); phase = "hidden"; toni.hideCard();
  }, 460);
}

$("howto").onclick = () => { $("steps").hidden = !$("steps").hidden; };
$("close").onclick = snooze;
