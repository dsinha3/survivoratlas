"""Scrape ESPN NFL moneylines and write de-vigged weekly odds."""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEASON = 2026
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def get_json(url: str, retries: int = 3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except Exception as exc:
            last = exc
            time.sleep(0.35 * (attempt + 1))
    raise last


def parse_ml(value):
    if value is None or value == "":
        return None
    text = str(value).strip()
    if text.upper() in {"OFF", "N/A", "NA", "-"}:
        return None
    if not re.fullmatch(r"[+-]?\d+", text):
        try:
            return int(float(text.replace("+", "")))
        except Exception:
            return None
    return int(text.replace("+", "") if not text.startswith("-") else text)


def format_ml(value):
    n = parse_ml(value)
    if n is None:
        return ""
    return f"{n:+d}"


def american_to_decimal(n: int) -> float:
    if n > 0:
        return (n / 100.0) + 1.0
    return (100.0 / abs(n)) + 1.0


def raw_implied(n: int) -> float:
    return 1.0 / american_to_decimal(n)


def ml_from_v3(side):
    if not side:
        return None
    return (side.get("close") or {}).get("odds") or (side.get("open") or {}).get("odds")


def ml_from_core(team_odds):
    if not team_odds:
        return None
    for key in ("current", "close", "open"):
        american = ((team_odds.get(key) or {}).get("moneyLine") or {}).get("american")
        if american:
            return american
    return team_odds.get("moneyLine")


def extract_week_num(label: str):
    match = re.search(r"Week\s+(\d+)", label or "")
    return int(match.group(1)) if match else None


def load_teams():
    payload = get_json("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50")
    teams = []
    for sport in payload.get("sports", []):
        for league in sport.get("leagues", []):
            for item in league.get("teams", []):
                team = item.get("team") or {}
                teams.append(
                    {
                        "id": str(team.get("id")),
                        "abbr": team.get("abbreviation"),
                        "name": team.get("displayName"),
                    }
                )
    return teams


def fetch_scoreboard(week: int):
    url = (
        "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
        f"?seasontype=2&week={week}&dates={SEASON}"
    )
    return week, get_json(url)


def fetch_event_odds(event_id: str):
    url = (
        "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
        f"events/{event_id}/competitions/{event_id}/odds"
    )
    try:
        return event_id, get_json(url)
    except Exception as exc:
        return event_id, {"error": str(exc)}


def competitors(comp):
    by_ha = {c.get("homeAway"): c for c in (comp.get("competitors") or [])}
    return by_ha.get("home"), by_ha.get("away")


def row_from_sides(week, game, date, status, book, home, away, ml_home, ml_away):
    rows = []
    for side, opp, ml, ha in ((home, away, ml_home, "home"), (away, home, ml_away, "away")):
        team = (side or {}).get("team") or {}
        oteam = (opp or {}).get("team") or {}
        rows.append(
            {
                "week": week,
                "team_id": str(team.get("id") or (side or {}).get("id") or ""),
                "team": team.get("displayName") or team.get("name"),
                "team_abbr": team.get("abbreviation"),
                "opponent": oteam.get("displayName") or oteam.get("name"),
                "opponent_abbr": oteam.get("abbreviation"),
                "home_away": ha,
                "moneyline": format_ml(ml) if ml is not None else "",
                "win_probability": "",
                "game": game,
                "game_date": date,
                "sportsbook": book,
                "status": status,
            }
        )
    return rows


def apply_devig(rows):
    games = {}
    for i, row in enumerate(rows):
        if row["opponent"] == "BYE" or not parse_ml(row["moneyline"]):
            continue
        key = (row["week"], tuple(sorted([row["team_abbr"], row["opponent_abbr"]])))
        games.setdefault(key, []).append(i)

    for idxs in games.values():
        if len(idxs) != 2:
            continue
        mls = [parse_ml(rows[i]["moneyline"]) for i in idxs]
        if any(m is None for m in mls):
            continue
        p1 = raw_implied(mls[0])
        p2 = raw_implied(mls[1])
        total = p1 + p2
        pct1 = round((p1 / total) * 100, 2)
        rows[idxs[0]]["win_probability"] = f"{pct1:.2f}"
        rows[idxs[1]]["win_probability"] = f"{100 - pct1:.2f}"


def current_week():
    board = get_json(
        "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2"
    )
    return int((board.get("week") or {}).get("number") or 2)


def refresh():
    teams = load_teams()
    now_week = current_week()
    rows = []
    seen = set()

    def add_rows(new_rows):
        for row in new_rows:
            key = (row["week"], row["team_abbr"])
            if not row["team_abbr"] or key in seen:
                continue
            seen.add(key)
            rows.append(row)

    boards = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(fetch_scoreboard, week) for week in range(1, 19)]
        for fut in as_completed(futs):
            week, data = fut.result()
            boards[week] = data

    events = []
    playing = {week: set() for week in range(1, 19)}
    for week, board in boards.items():
        for event in board.get("events", []):
            comp = (event.get("competitions") or [{}])[0]
            home, away = competitors(comp)
            if not home or not away:
                continue
            ht = (home.get("team") or {}).get("abbreviation")
            at = (away.get("team") or {}).get("abbreviation")
            playing[week].update({ht, at})
            events.append(
                {
                    "week": week,
                    "id": event.get("id"),
                    "game": event.get("name", ""),
                    "date": comp.get("date") or event.get("date", ""),
                    "status": ((comp.get("status") or event.get("status") or {}).get("type") or {}).get(
                        "description", ""
                    ),
                    "home": home,
                    "away": away,
                }
            )

    odds_by_id = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(fetch_event_odds, ev["id"]) for ev in events if ev["id"]]
        for fut in as_completed(futs):
            event_id, payload = fut.result()
            odds_by_id[event_id] = payload

    for ev in events:
        payload = odds_by_id.get(ev["id"]) or {}
        items = payload.get("items") or []
        book = ""
        ml_home = ml_away = None
        if items:
            odds = items[0]
            book = (odds.get("provider") or {}).get("name") or ""
            ml_home = ml_from_core(odds.get("homeTeamOdds"))
            ml_away = ml_from_core(odds.get("awayTeamOdds"))
        add_rows(
            row_from_sides(
                ev["week"],
                ev["game"],
                ev["date"],
                ev["status"],
                book,
                ev["home"],
                ev["away"],
                ml_home,
                ml_away,
            )
        )

    for week, playing_abbrs in playing.items():
        if not playing_abbrs:
            continue
        for team in teams:
            if team["abbr"] not in playing_abbrs:
                add_rows(
                    [
                        {
                            "week": week,
                            "team_id": team["id"],
                            "team": team["name"],
                            "team_abbr": team["abbr"],
                            "opponent": "BYE",
                            "opponent_abbr": "BYE",
                            "home_away": "",
                            "moneyline": "",
                            "win_probability": "",
                            "game": "",
                            "game_date": "",
                            "sportsbook": "",
                            "status": "Bye",
                        }
                    ]
                )

    apply_devig(rows)
    rows.sort(key=lambda r: (r["week"], r["team"] or "", r["team_abbr"] or ""))

    fieldnames = [
        "week",
        "team",
        "team_abbr",
        "opponent",
        "opponent_abbr",
        "home_away",
        "moneyline",
        "win_probability",
        "game",
        "game_date",
        "sportsbook",
        "status",
    ]
    with (ROOT / "nfl_weekly_win_odds.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    weeks = {}
    for row in rows:
        week = int(row["week"])
        if week < 2 or week > 18:
            continue
        weeks.setdefault(week, []).append(
            {
                "team": row["team"],
                "abbr": row["team_abbr"],
                "opponent": row["opponent"],
                "opponentAbbr": row["opponent_abbr"],
                "homeAway": row["home_away"],
                "moneyline": row["moneyline"],
                "winProbability": float(row["win_probability"]) if row["win_probability"] else None,
                "game": row["game"],
                "gameDate": row["game_date"],
                "status": row["status"],
            }
        )

    payload = {
        "season": SEASON,
        "currentWeek": now_week,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN / DraftKings moneylines, multiplicative de-vig",
        "weeks": weeks,
    }
    (ROOT / "odds.json").write_text(json.dumps(payload))
    (ROOT / "data.js").write_text("window.ATLAS_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")

    games = sum(1 for row in rows if row["opponent"] != "BYE")
    return {
        "ok": True,
        "updatedAt": payload["updatedAt"],
        "currentWeek": now_week,
        "rows": len(rows),
        "games": games,
        "weeks": sorted(weeks),
    }


if __name__ == "__main__":
    print(json.dumps(refresh(), indent=2))
