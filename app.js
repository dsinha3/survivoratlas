const TEAM_COLORS = {
  ARI: "#97233F",
  ATL: "#A71930",
  BAL: "#241773",
  BUF: "#00338D",
  CAR: "#0085CA",
  CHI: "#0B162A",
  CIN: "#FB4F14",
  CLE: "#311D00",
  DAL: "#003594",
  DEN: "#FB4F14",
  DET: "#0076B6",
  GB: "#203731",
  HOU: "#03202F",
  IND: "#002C5F",
  JAX: "#006778",
  KC: "#E31837",
  LAC: "#0080C6",
  LAR: "#003594",
  LV: "#A5ACAF",
  MIA: "#008E97",
  MIN: "#4F2683",
  NE: "#002244",
  NO: "#D3BC8D",
  NYG: "#0B2265",
  NYJ: "#125740",
  PHI: "#004C54",
  PIT: "#FFB612",
  SEA: "#69BE28",
  SF: "#AA0000",
  TB: "#D50A0A",
  TEN: "#4B92DB",
  WSH: "#5A1414",
};

const STORAGE_KEY = "survivoratlas-picks-2026-v2";
const ODDS_CACHE_KEY = "survivoratlas-odds-2026";
const WEEK_OVERRIDE_KEY = "survivoratlas-week-override-2026";
const USED_PRIOR_KEY = "survivoratlas-used-prior-2026";
const DOUBLE_WEEKS = new Set([9, 12, 13, 14, 15, 16]);

// Tuesday starts. W3 = Sep 22 2026, then +7 days.
const WEEK_STARTS = {
  1: "2026-09-08",
  2: "2026-09-15",
  3: "2026-09-22",
  4: "2026-09-29",
  5: "2026-10-06",
  6: "2026-10-13",
  7: "2026-10-20",
  8: "2026-10-27",
  9: "2026-11-03",
  10: "2026-11-10",
  11: "2026-11-17",
  12: "2026-11-24",
  13: "2026-12-01",
  14: "2026-12-08",
  15: "2026-12-15",
  16: "2026-12-22",
  17: "2026-12-29",
  18: "2027-01-05",
};

function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function calendarWeek(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let current = 1;
  for (const week of Object.keys(WEEK_STARTS)
    .map(Number)
    .sort((a, b) => a - b)) {
    if (today >= parseYmd(WEEK_STARTS[week])) current = week;
  }
  return Math.min(18, Math.max(2, current));
}

function formatWeekStart(week) {
  return parseYmd(WEEK_STARTS[week]).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

let data;
let weekNumbers;
let teams;
let byTeamWeek;

function readCachedOdds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ODDS_CACHE_KEY) || "null");
    return parsed?.weeks ? parsed : null;
  } catch {
    return null;
  }
}

function newerOdds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (a.updatedAt || "") >= (b.updatedAt || "") ? a : b;
}

function hydrate(payload) {
  data = payload;
  weekNumbers = Object.keys(data.weeks)
    .map(Number)
    .sort((a, b) => a - b);
  teams = [...data.weeks[weekNumbers[0]]]
    .map((row) => ({
      abbr: row.abbr,
      team: row.team,
      color: TEAM_COLORS[row.abbr] || "#6b6456",
    }))
    .sort((a, b) => a.team.localeCompare(b.team));
  byTeamWeek = {};
  for (const week of weekNumbers) {
    for (const row of data.weeks[week]) {
      if (!byTeamWeek[row.abbr]) byTeamWeek[row.abbr] = {};
      byTeamWeek[row.abbr][week] = row;
    }
  }
}

hydrate(newerOdds(window.ATLAS_DATA, readCachedOdds()));

const META_KEYS = [
  { key: "games", label: "Gms", title: "Remaining pickable weeks" },
  { key: "over50", label: "50+", title: "Remaining weeks at least 50% to win" },
  { key: "over60", label: "60+", title: "Remaining weeks at least 60% to win" },
  { key: "over70", label: "70+", title: "Remaining weeks at least 70% to win" },
  { key: "over80", label: "80+", title: "Remaining weeks at least 80% to win" },
];

function loadWeekOverride() {
  const n = Number(localStorage.getItem(WEEK_OVERRIDE_KEY));
  return n >= 2 && n <= 18 ? n : null;
}

function loadUsedPrior() {
  try {
    const list = JSON.parse(localStorage.getItem(USED_PRIOR_KEY) || "[]");
    return list.filter((abbr) => teams.some((t) => t.abbr === abbr));
  } catch {
    return [];
  }
}

const weekOverride = loadWeekOverride();
const startWeek = weekOverride || calendarWeek();

const state = {
  picks: loadPicks(),
  usedPrior: loadUsedPrior(),
  weekOverride,
  sortWeek: startWeek,
  sortDir: "desc",
  sortMeta: "",
  focusWeek: startWeek,
};

function activeWeek() {
  return state.weekOverride || calendarWeek();
}

function liveWeeks() {
  return weekNumbers.filter((week) => week >= activeWeek());
}

function clampView() {
  const live = liveWeeks();
  if (!live.includes(state.sortWeek)) state.sortWeek = live[0] || activeWeek();
  if (!live.includes(state.focusWeek)) state.focusWeek = live[0] || activeWeek();
}

function weekCapacity(week) {
  return DOUBLE_WEEKS.has(week) ? 2 : 1;
}

function weekPicks(week) {
  const value = state.picks[week];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function allPicks() {
  return weekNumbers.flatMap((week) => weekPicks(week));
}

function livePicks() {
  return liveWeeks().flatMap((week) => weekPicks(week));
}

function totalSlots() {
  return liveWeeks().reduce((sum, week) => sum + weekCapacity(week), 0);
}

function loadPicks() {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem("survivoratlas-picks-2026") || "{}"
    );
    const clean = {};
    const seen = new Set();
    for (const [week, value] of Object.entries(raw)) {
      const w = Number(week);
      if (!weekNumbers.includes(w)) continue;
      const names = (Array.isArray(value) ? value : [value]).filter((abbr) =>
        teams.some((t) => t.abbr === abbr)
      );
      const unique = [];
      for (const abbr of names) {
        if (seen.has(abbr) || unique.length >= weekCapacity(w)) continue;
        seen.add(abbr);
        unique.push(abbr);
      }
      if (unique.length) clean[w] = unique;
    }
    return clean;
  } catch {
    return {};
  }
}

function savePicks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.picks));
}

function saveUsedPrior() {
  localStorage.setItem(USED_PRIOR_KEY, JSON.stringify(state.usedPrior));
}

function usedTeams() {
  return new Set([...state.usedPrior, ...allPicks()]);
}

function pickWeek(abbr) {
  return Number(weekNumbers.find((week) => weekPicks(week).includes(abbr)) || 0);
}

function isBye(cell) {
  return !cell || cell.status === "Bye" || cell.winProbability == null;
}

function isFinal(cell) {
  return cell && cell.status === "Final";
}

function canPick(abbr, week) {
  if (week < activeWeek()) return false;
  if (state.usedPrior.includes(abbr)) return false;
  const cell = byTeamWeek[abbr][week];
  if (isBye(cell) || isFinal(cell)) return false;
  const usedIn = pickWeek(abbr);
  return !usedIn || usedIn === week;
}

function vsLine(cell) {
  if (isBye(cell)) return "BYE";
  const prefix = cell.homeAway === "away" ? "@" : "vs";
  return `${prefix} ${cell.opponentAbbr}`;
}

function formatProb(p) {
  if (p == null) return "—";
  return `${p.toFixed(1)}%`;
}

function logoUrl(abbr) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;
}

function remainingCells(abbr) {
  if (state.usedPrior.includes(abbr) || pickWeek(abbr)) return [];
  return liveWeeks()
    .map((week) => ({ week, cell: byTeamWeek[abbr][week] }))
    .filter(({ cell }) => !isBye(cell) && !isFinal(cell));
}

function teamStats(abbr) {
  const live = remainingCells(abbr);
  const probs = live.map(({ cell }) => cell.winProbability);
  const best = live.reduce((top, row) => {
    if (!top || row.cell.winProbability > top.cell.winProbability) return row;
    return top;
  }, null);
  return {
    games: live.length,
    over50: probs.filter((p) => p >= 50).length,
    over60: probs.filter((p) => p >= 60).length,
    over70: probs.filter((p) => p >= 70).length,
    over80: probs.filter((p) => p >= 80).length,
    bestWeek: best ? best.week : null,
    bestProb: best ? best.cell.winProbability : null,
  };
}

function sortedTeams() {
  const dir = state.sortDir;
  const sign = dir === "asc" ? 1 : -1;
  return [...teams].sort((a, b) => {
    if (state.sortMeta) {
      const as = teamStats(a.abbr)[state.sortMeta];
      const bs = teamStats(b.abbr)[state.sortMeta];
      if (as !== bs) return (as - bs) * sign;
      return a.abbr.localeCompare(b.abbr);
    }
    const week = state.sortWeek;
    const ac = byTeamWeek[a.abbr][week];
    const bc = byTeamWeek[b.abbr][week];
    const ap = ac?.winProbability;
    const bp = bc?.winProbability;
    const aDead = isBye(ac);
    const bDead = isBye(bc);
    if (aDead && bDead) return a.abbr.localeCompare(b.abbr);
    if (aDead) return 1;
    if (bDead) return -1;
    return dir === "asc" ? ap - bp : bp - ap;
  });
}

function openSlots() {
  return liveWeeks().reduce(
    (sum, week) => sum + Math.max(0, weekCapacity(week) - weekPicks(week).length),
    0
  );
}

function pickProb(abbr, week) {
  return byTeamWeek[abbr]?.[week]?.winProbability ?? null;
}

function renderPath() {
  const live = liveWeeks();
  const n = livePicks().length;
  const slots = totalSlots();
  const gaps = openSlots();
  document.querySelector("#slate").textContent = `${n} / ${slots} path`;
  document.querySelector("#path-gaps").textContent =
    gaps === 0 ? "Path complete" : `${gaps} slot${gaps === 1 ? "" : "s"} left`;

  document.querySelector("#path").innerHTML = live
    .map((week, i) => {
      const picks = weekPicks(week);
      const cap = weekCapacity(week);
      const filled = picks.length >= cap;
      const partial = picks.length > 0 && !filled;
      const chips = Array.from({ length: cap }, (_, slot) => {
        const abbr = picks[slot];
        if (!abbr) {
          return `<button type="button" class="slot is-empty" data-jump-week="${week}">+</button>`;
        }
        const p = pickProb(abbr, week);
        return `
          <button type="button" class="slot is-set" data-unpick="${abbr}" data-week="${week}" title="Remove ${abbr} from week ${week}">
            <img src="${logoUrl(abbr)}" alt="" width="16" height="16" />
            <span>${abbr}</span>
            <small>${p != null ? `${p.toFixed(0)}%` : ""}</small>
          </button>
        `;
      }).join("");
      return `
        ${i ? `<span class="path-join" aria-hidden="true"></span>` : ""}
        <div class="node ${filled ? "is-filled" : ""} ${partial ? "is-partial" : ""} ${DOUBLE_WEEKS.has(week) ? "is-double" : ""} ${week === state.focusWeek ? "is-focus" : ""} ${week === activeWeek() ? "is-now" : ""}">
          <button type="button" class="node-week" data-jump-week="${week}">
            W${week}${DOUBLE_WEEKS.has(week) ? " · 2x" : ""}
          </button>
          <div class="slots">${chips}</div>
        </div>
      `;
    })
    .join("");
}

function renderMap() {
  const used = usedTeams();
  const rows = sortedTeams();
  const arrow = state.sortDir === "desc" ? "↓" : "↑";
  const live = liveWeeks();

  const head = live
    .map((week) => {
      const on = !state.sortMeta && week === state.sortWeek ? "is-sorted" : "";
      const now = week === activeWeek() ? "is-now" : "";
      const focus = week === state.focusWeek ? "is-focus" : "";
      const dbl = DOUBLE_WEEKS.has(week) ? "is-double" : "";
      const picks = weekPicks(week);
      const sub = !state.sortMeta && week === state.sortWeek
        ? `${arrow} ${DOUBLE_WEEKS.has(week) ? "2x" : "prob"}`
        : picks.length
          ? picks.join(" / ")
          : DOUBLE_WEEKS.has(week)
            ? "2x"
            : "prob";
      return `
        <th class="week-col ${on} ${now} ${focus} ${dbl}" id="col-${week}">
          <button type="button" data-sort-week="${week}" aria-label="Sort by week ${week} probability">
            <span>W${week}</span>
            <small>${sub}</small>
          </button>
        </th>
      `;
    })
    .join("");

  const metaHead = META_KEYS.map(
    (meta) => `
      <button
        type="button"
        class="meta-sort ${state.sortMeta === meta.key ? "is-sorted" : ""}"
        data-sort-meta="${meta.key}"
        title="${meta.title}"
      >
        ${meta.label}${state.sortMeta === meta.key ? ` ${arrow}` : ""}
      </button>
    `
  ).join("");

  const body = rows
    .map((team) => {
      const usedIn = pickWeek(team.abbr);
      const prior = state.usedPrior.includes(team.abbr);
      const dead = used.has(team.abbr);
      const stats = teamStats(team.abbr);
      const usedNote = usedIn ? `used W${usedIn}` : prior ? "already used" : team.team;
      const cells = live
        .map((week) => {
          const cell = byTeamWeek[team.abbr][week];
          const pickHere = weekPicks(week).includes(team.abbr);
          const bye = isBye(cell);
          const fin = isFinal(cell);
          const locked = dead && !pickHere;
          const weekFull = weekPicks(week).length >= weekCapacity(week) && !pickHere;
          const blocked = (!canPick(team.abbr, week) && !pickHere) || (weekFull && weekCapacity(week) > 1);
          const classes = [
            "cell",
            bye ? "is-bye" : "",
            fin ? "is-final" : "",
            pickHere ? "is-pick" : "",
            locked ? "is-spent" : "",
            blocked && !bye && !fin ? "is-blocked" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = bye
            ? "Bye week"
            : fin
              ? `${team.abbr} week ${week} already final`
              : pickHere
                ? `Remove ${team.abbr} from week ${week}`
                : `Pick ${team.abbr} in week ${week}`;
          return `
            <td>
              <button
                type="button"
                class="${classes}"
                data-team="${team.abbr}"
                data-week="${week}"
                ${blocked ? "disabled" : ""}
                aria-label="${label}"
              >
                <span class="prob">${formatProb(cell.winProbability)}</span>
                <span class="match">${vsLine(cell)}</span>
              </button>
            </td>
          `;
        })
        .join("");
      return {
        weekRow: `
        <tr class="${dead ? "is-used" : ""}" data-team-row="${team.abbr}">
          <th class="team-cell">
            <div class="team-inner">
              <span class="xmark" aria-hidden="true">×</span>
              <img class="logo" src="${logoUrl(team.abbr)}" alt="" width="22" height="22" />
              <span class="team-name">
                <span class="abbr">${team.abbr}</span>
                <span class="used-note">${usedNote}</span>
              </span>
            </div>
          </th>
          ${cells}
        </tr>
      `,
        metaRow: `
        <div class="meta-row ${dead ? "is-used" : ""}" data-team-row="${team.abbr}">
          ${META_KEYS.map((meta) => `<span class="meta-n" title="${meta.title}">${stats[meta.key]}</span>`).join("")}
          <span class="meta-best">${stats.bestWeek ? `W${stats.bestWeek} ${stats.bestProb.toFixed(0)}%` : "—"}</span>
        </div>
      `,
      };
    });

  document.querySelector("#map").innerHTML = `
    <div class="board">
      <div class="grid-wrap" id="week-scroll">
        <table class="atlas">
          <thead>
            <tr>
              <th class="team-cell corner"><div class="team-inner">Team</div></th>
              ${head}
            </tr>
          </thead>
          <tbody>${body.map((row) => row.weekRow).join("")}</tbody>
        </table>
      </div>
      <aside class="meta-rail" id="meta-scroll" aria-label="Remaining week counts">
        <div class="meta-head">
          ${metaHead}
          <span class="meta-best">Best left</span>
        </div>
        <div class="meta-body">${body.map((row) => row.metaRow).join("")}</div>
      </aside>
    </div>
  `;

  const weekScroll = document.querySelector("#week-scroll");
  const metaScroll = document.querySelector("#meta-scroll");
  let syncing = false;
  const sync = (from, to) => {
    from.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      to.scrollTop = from.scrollTop;
      syncing = false;
    });
  };
  sync(weekScroll, metaScroll);
  sync(metaScroll, weekScroll);
}

function renderWeekBar() {
  const week = activeWeek();
  const auto = state.weekOverride == null;
  document.querySelector("#week-auto").textContent = `W${week}`;
  document.querySelector("#week-auto").classList.toggle("is-on", auto);
  document.querySelector("#week-prev").disabled = week <= 2;
  document.querySelector("#week-next").disabled = week >= 18;
  document.querySelector("#week-cal-note").textContent = auto
    ? `Auto · started ${formatWeekStart(week)}`
    : `Manual · started ${formatWeekStart(week)}`;
}

function renderUsed() {
  const chips = document.querySelector("#used-chips");
  chips.innerHTML = state.usedPrior.length
    ? state.usedPrior
        .map(
          (abbr) => `
        <span class="used-chip">
          <img src="${logoUrl(abbr)}" alt="" width="14" height="14" />
          ${abbr}
          <button type="button" data-unuse="${abbr}" aria-label="Remove ${abbr} from used">×</button>
        </span>
      `
        )
        .join("")
    : `<span class="cal-note">None yet</span>`;

  const select = document.querySelector("#used-select");
  select.innerHTML =
    `<option value="">Add a used team…</option>` +
    teams
      .filter((t) => !state.usedPrior.includes(t.abbr))
      .map((t) => `<option value="${t.abbr}">${t.abbr} — ${t.team}</option>`)
      .join("");
}

function setActiveWeek(week) {
  if (week == null) {
    state.weekOverride = null;
    localStorage.removeItem(WEEK_OVERRIDE_KEY);
  } else {
    state.weekOverride = Math.min(18, Math.max(2, week));
    localStorage.setItem(WEEK_OVERRIDE_KEY, String(state.weekOverride));
  }
  clampView();
  renderAll();
}

function addUsedPrior(abbr) {
  if (!abbr || state.usedPrior.includes(abbr)) return;
  state.usedPrior = [...state.usedPrior, abbr];
  for (const week of liveWeeks()) {
    const picks = weekPicks(week);
    if (!picks.includes(abbr)) continue;
    const next = picks.filter((name) => name !== abbr);
    if (next.length) state.picks[week] = next;
    else delete state.picks[week];
  }
  saveUsedPrior();
  savePicks();
  renderAll();
}

function removeUsedPrior(abbr) {
  state.usedPrior = state.usedPrior.filter((name) => name !== abbr);
  saveUsedPrior();
  renderAll();
}

function setPick(abbr, week) {
  const current = weekPicks(week);
  if (current.includes(abbr)) {
    const next = current.filter((name) => name !== abbr);
    if (next.length) state.picks[week] = next;
    else delete state.picks[week];
  } else {
    if (!canPick(abbr, week)) return;
    const cap = weekCapacity(week);
    if (current.length >= cap) {
      if (cap === 1) state.picks[week] = [abbr];
      else return;
    } else {
      state.picks[week] = [...current, abbr];
    }
  }
  state.focusWeek = week;
  savePicks();
  renderAll();
}

function jumpToWeek(week) {
  state.focusWeek = week;
  state.sortWeek = week;
  state.sortMeta = "";
  state.sortDir = "desc";
  renderAll();
  document.getElementById(`col-${week}`)?.scrollIntoView({ inline: "center", block: "nearest" });
}

function renderAll() {
  clampView();
  renderWeekBar();
  renderUsed();
  renderPath();
  renderMap();
  document.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.sort === state.sortDir);
  });
}

function showUpdated(iso) {
  const el = document.querySelector("#odds-status");
  if (!el) return;
  if (!iso) {
    el.textContent = "No scrape time yet";
    return;
  }
  const when = new Date(iso);
  el.textContent = `Lines ${when.toLocaleString()}`;
}

async function refreshOdds() {
  const btn = document.querySelector("#refresh-odds");
  const status = document.querySelector("#odds-status");
  btn.disabled = true;
  status.textContent = "Pulling ESPN and re-calculating…";
  try {
    const res = await fetch("/api/refresh", { method: "POST" });
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        res.status === 404
          ? "Refresh API is not deployed yet."
          : "Refresh failed. Try again in a moment."
      );
    }
    if (!res.ok || !payload.ok || !payload.weeks) {
      throw new Error(payload.error || "Refresh failed");
    }
    localStorage.setItem(ODDS_CACHE_KEY, JSON.stringify(payload));
    hydrate(payload);
    clampView();
    showUpdated(data.updatedAt);
    renderAll();
    btn.disabled = false;
  } catch (err) {
    status.textContent = err.message || "Could not refresh odds";
    btn.disabled = false;
  }
}

function bind() {
  document.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sortDir = btn.dataset.sort;
      renderAll();
    });
  });

  document.querySelector("#refresh-odds").addEventListener("click", () => {
    refreshOdds();
  });

  document.querySelector("#week-prev").addEventListener("click", () => {
    setActiveWeek(activeWeek() - 1);
  });
  document.querySelector("#week-next").addEventListener("click", () => {
    setActiveWeek(activeWeek() + 1);
  });
  document.querySelector("#week-auto").addEventListener("click", () => {
    setActiveWeek(null);
  });

  document.querySelector("#used-add").addEventListener("click", () => {
    addUsedPrior(document.querySelector("#used-select").value);
  });
  document.querySelector("#used-chips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-unuse]");
    if (btn) removeUsedPrior(btn.dataset.unuse);
  });

  document.querySelector("#clear-picks").addEventListener("click", () => {
    state.picks = {};
    savePicks();
    renderAll();
  });

  document.querySelector("#path").addEventListener("click", (e) => {
    const unpick = e.target.closest("[data-unpick]");
    if (unpick) {
      setPick(unpick.dataset.unpick, Number(unpick.dataset.week));
      return;
    }
    const jump = e.target.closest("[data-jump-week]");
    if (jump) jumpToWeek(Number(jump.dataset.jumpWeek));
  });

  document.querySelector("#map").addEventListener("click", (e) => {
    const metaBtn = e.target.closest("[data-sort-meta]");
    if (metaBtn) {
      const key = metaBtn.dataset.sortMeta;
      if (state.sortMeta === key) {
        state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      } else {
        state.sortMeta = key;
        state.sortDir = "desc";
      }
      renderAll();
      return;
    }
    const sortBtn = e.target.closest("[data-sort-week]");
    if (sortBtn) {
      const week = Number(sortBtn.dataset.sortWeek);
      state.sortMeta = "";
      if (state.sortWeek === week) {
        state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      } else {
        state.sortWeek = week;
        state.sortDir = "desc";
      }
      renderAll();
      return;
    }
    const cell = e.target.closest("[data-team][data-week]");
    if (cell && !cell.disabled) {
      setPick(cell.dataset.team, Number(cell.dataset.week));
    }
  });
}

showUpdated(data.updatedAt);
renderAll();
bind();
