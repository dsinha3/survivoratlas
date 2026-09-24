const SEASON = 2026;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function getJson(url, retries = 3) {
  let last;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw last;
}

function parseMl(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (["OFF", "N/A", "NA", "-"].includes(text.toUpperCase())) return null;
  const n = Number(text.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

function formatMl(value) {
  const n = parseMl(value);
  if (n == null) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

function implied(n) {
  const decimal = n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
  return 1 / decimal;
}

function mlFromCore(teamOdds) {
  if (!teamOdds) return null;
  for (const key of ["current", "close", "open"]) {
    const american = teamOdds[key]?.moneyLine?.american;
    if (american) return american;
  }
  return teamOdds.moneyLine ?? null;
}

function competitors(comp) {
  const byHa = {};
  for (const c of comp.competitors || []) byHa[c.homeAway] = c;
  return [byHa.home, byHa.away];
}

async function mapPool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return out;
}

async function scrapeOdds() {
  const [teamsPayload, currentBoard] = await Promise.all([
    getJson("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50"),
    getJson("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2"),
  ]);

  const teams = [];
  for (const sport of teamsPayload.sports || []) {
    for (const league of sport.leagues || []) {
      for (const item of league.teams || []) {
        const team = item.team || {};
        teams.push({
          id: String(team.id),
          abbr: team.abbreviation,
          name: team.displayName,
        });
      }
    }
  }

  const currentWeek = Number(currentBoard.week?.number || 2);
  const weekNums = Array.from({ length: 17 }, (_, i) => i + 2);
  const boards = {};
  await mapPool(weekNums, 6, async (week) => {
    boards[week] = await getJson(
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${SEASON}`
    );
  });

  const events = [];
  const playing = Object.fromEntries(weekNums.map((week) => [week, new Set()]));
  for (const week of weekNums) {
    for (const event of boards[week].events || []) {
      const comp = (event.competitions || [{}])[0];
      const [home, away] = competitors(comp);
      if (!home || !away) continue;
      const ht = home.team?.abbreviation;
      const at = away.team?.abbreviation;
      if (ht) playing[week].add(ht);
      if (at) playing[week].add(at);
      events.push({
        week,
        id: event.id,
        game: event.name || "",
        date: comp.date || event.date || "",
        status: comp.status?.type?.description || event.status?.type?.description || "",
        home,
        away,
      });
    }
  }

  const oddsById = {};
  await mapPool(
    events.filter((ev) => ev.id),
    12,
    async (ev) => {
      try {
        oddsById[ev.id] = await getJson(
          `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${ev.id}/competitions/${ev.id}/odds`
        );
      } catch (err) {
        oddsById[ev.id] = { error: String(err.message || err) };
      }
    }
  );

  const rows = [];
  const seen = new Set();
  const addRow = (row) => {
    const key = `${row.week}:${row.abbr}`;
    if (!row.abbr || seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  const sideRow = (week, game, date, status, book, side, opp, ml, homeAway) => {
    const team = side.team || {};
    const oteam = opp.team || {};
    addRow({
      week,
      team: team.displayName || team.name,
      abbr: team.abbreviation,
      opponent: oteam.displayName || oteam.name,
      opponentAbbr: oteam.abbreviation,
      homeAway,
      moneyline: formatMl(ml),
      winProbability: null,
      game,
      gameDate: date,
      status,
    });
  };

  for (const ev of events) {
    const items = oddsById[ev.id]?.items || [];
    let book = "";
    let mlHome = null;
    let mlAway = null;
    if (items[0]) {
      book = items[0].provider?.name || "";
      mlHome = mlFromCore(items[0].homeTeamOdds);
      mlAway = mlFromCore(items[0].awayTeamOdds);
    }
    sideRow(ev.week, ev.game, ev.date, ev.status, book, ev.home, ev.away, mlHome, "home");
    sideRow(ev.week, ev.game, ev.date, ev.status, book, ev.away, ev.home, mlAway, "away");
  }

  for (const week of weekNums) {
    const live = playing[week];
    if (!live.size) continue;
    for (const team of teams) {
      if (!live.has(team.abbr)) {
        addRow({
          week,
          team: team.name,
          abbr: team.abbr,
          opponent: "BYE",
          opponentAbbr: "BYE",
          homeAway: "",
          moneyline: "",
          winProbability: null,
          game: "",
          gameDate: "",
          status: "Bye",
        });
      }
    }
  }

  const games = {};
  rows.forEach((row, i) => {
    if (row.opponent === "BYE" || !parseMl(row.moneyline)) return;
    const key = `${row.week}:${[row.abbr, row.opponentAbbr].sort().join("-")}`;
    (games[key] ||= []).push(i);
  });
  for (const idxs of Object.values(games)) {
    if (idxs.length !== 2) continue;
    const mls = idxs.map((i) => parseMl(rows[i].moneyline));
    if (mls.some((n) => n == null)) continue;
    const p1 = implied(mls[0]);
    const p2 = implied(mls[1]);
    const pct1 = Math.round((p1 / (p1 + p2)) * 10000) / 100;
    rows[idxs[0]].winProbability = pct1;
    rows[idxs[1]].winProbability = Math.round((100 - pct1) * 100) / 100;
  }

  rows.sort((a, b) => a.week - b.week || (a.team || "").localeCompare(b.team || "") || (a.abbr || "").localeCompare(b.abbr || ""));

  const weeks = {};
  for (const row of rows) {
    (weeks[row.week] ||= []).push(row);
  }

  return {
    ok: true,
    season: SEASON,
    currentWeek,
    updatedAt: new Date().toISOString(),
    source: "ESPN / DraftKings moneylines, multiplicative de-vig",
    weeks,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  try {
    const payload = await scrapeOdds();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
};
