// AI BET GENERATOR — Refactor v2 (React + TypeScript, single-file demo)
// Ovaj fajl je spreman za GitHub Pages uz React/ReactDOM/Babel preko CDN-a.

// =============================================================================
// Konstante / konfiguracija
// =============================================================================
const TL = 900_000; // donji prag ciljne kvote (product)
const TH = 1_100_000; // gornji prag ciljne kvote (product)
const LEGS_MIN = 7;
const LEGS_MAX = 20;
const STAKE = 10; // RSD, demonstraciono fiksan iznos
const MAX_PER_COMP = 3; // najviše tipova po takmičenju u tiketu
const TRIES = 40; // pokušaja generisanja per klik
const ARCHIVE_KEY = "aibet_archive_v1";
const ARCHIVE_CAP = 50; // čuvamo 50 poslednjih (tiket + singl)

// Bonus tabela po broju parova (step-like)
const BONUS_BY_LEGS = [
  { min: 7, pct: 12 },
  { min: 8, pct: 16 },
  { min: 9, pct: 22 },
  { min: 10, pct: 28 },
  { min: 11, pct: 33 },
  { min: 12, pct: 38 },
  { min: 13, pct: 43 },
  { min: 14, pct: 50 },
  { min: 15, pct: 55 },
  { min: 16, pct: 60 },
  { min: 17, pct: 65 },
  { min: 18, pct: 70 },
  { min: 19, pct: 75 },
  { min: 20, pct: 80 },
];

const bonusPctFor = (n: number) => {
  let pct = 0;
  for (const t of BONUS_BY_LEGS) if (n >= t.min) pct = t.pct;
  return pct;
};

// Minimalni/maksimalni broj specijala prema broju parova
const specBounds = (legs: number) => (legs >= 10 ? { min: 1, max: 3 } : { min: 0, max: 2 });

// Centralizovano računanje isplate sa bonusom
function computePayout(product: number, legs: number, stake = STAKE) {
  const pct = bonusPctFor(legs);
  const base = Math.round(product * stake);
  const bonus = Math.round((base * pct) / 100);
  const total = base + bonus;
  return { base, bonus, total, pct };
}

// =============================================================================
// Tipovi
// =============================================================================
type Sport =
  | "Football"
  | "Basketball"
  | "Tennis"
  | "Ice Hockey"
  | "Baseball"
  | "American Football";

type Market =
  | "Konačan ishod"
  | "Golovi"
  | "Poluvreme/kraj"
  | "Poeni"
  | "Specijal"
  | "Hendikep"
  | "Ukupno";

interface EventRow {
  id: string;
  sport: Sport;
  competition: string;
  teams: string; // "Team A vs Team B"
  market: Market;
  selection: string; // tip, npr. "1", "GG3+", "VINISIJUS DAJE GOL"
  odds: number; // kvota
  startTime: number; // epoch ms
}

interface TicketLeg {
  event: EventRow;
}

interface Ticket {
  legs: TicketLeg[];
  product: number; // proizvod kvota
  inRange: boolean; // da li je product u [TL, TH]
}

// Arhiva
interface ArchiveSingle {
  kind: "single";
  id: string; // SING-xxxxx
  at: number; // epoch ms
  sport: Sport;
  competition: string;
  teams: string;
  market: Market;
  selection: string;
  odds: number;
  stake: number;
  potentialPayout: number;
}
interface ArchiveTicketItem { sport: Sport; competition: string; teams: string; market: Market; selection: string; odds: number; }
interface ArchiveTicket {
  kind: "ticket";
  id: string; // SLIP-xxxxx
  at: number;
  legs: number;
  product: number;
  stake: number;
  payoutBeforeBonus: number;
  bonusPct: number;
  bonusAmount: number;
  payoutWithBonus: number;
  items: ArchiveTicketItem[];
}

type ArchiveItem = ArchiveSingle | ArchiveTicket;

// =============================================================================
// Sitne util funkcije
// =============================================================================
const pick = <T,>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const inc = (m: Map<string, number>, k: string, v = 1) => m.set(k, (m.get(k) || 0) + v);
const dec = (m: Map<string, number>, k: string, v = 1) => m.set(k, (m.get(k) || 0) - v);

function rnd32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuf<T>(arr: T[], rnd: () => number) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pad = (n: number) => (n < 10 ? "0" : "") + n;
const fmtLeft = (ms: number) => {
  if (ms < 0) ms = 0;
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400);
  let r = t % 86400;
  const h = Math.floor(r / 3600);
  r %= 3600;
  const m = Math.floor(r / 60);
  const s = r % 60;
  return d ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
};

// =============================================================================
// EU format brojeva (tačka za hiljade, zarez za decimale)
// =============================================================================
function fmtEu(num: number, decimals?: number) {
  const sign = num < 0 ? "-" : "";
  const n = Math.abs(num);
  const s = decimals != null ? n.toFixed(decimals) : Math.round(n).toString();
  const [intPartRaw, frac] = s.split(".");
  const intPart = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sign + (frac ? intPart + "," + frac : intPart);
}

const fmtMoney = (n: number) => `${fmtEu(Math.round(n))} RSD`;
const fmtDateTime = (ts: number) => new Date(ts).toLocaleString("sr-RS");

// =============================================================================
// Domen / podaci (takmičenja, timovi)
// =============================================================================
const COMPS = [
  "UEFA Champions League",
  "English Premier League",
  "La Liga",
  "Bundesliga",
  "Ligue 1",
  "Serie A",
  "Eredivisie",
  "Primeira Liga",
  "MLS",
  "NBA",
  "EuroLeague",
  "NHL",
  "MLB",
  "NFL",
];

const COMP2SPORT: Record<string, Sport> = {
  "UEFA Champions League": "Football",
  "English Premier League": "Football",
  "La Liga": "Football",
  Bundesliga: "Football",
  "Ligue 1": "Football",
  "Serie A": "Football",
  Eredivisie: "Football",
  "Primeira Liga": "Football",
  MLS: "Football",
  NBA: "Basketball",
  EuroLeague: "Basketball",
  NHL: "Ice Hockey",
  MLB: "Baseball",
  NFL: "American Football",
};

// Izbor klubova
const COMP_TEAMS: Record<string, string[]> = {
  "English Premier League": [
    "Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Chelsea","Crystal Palace","Everton","Fulham","Ipswich Town","Leicester City","Liverpool","Manchester City","Manchester United","Newcastle United","Nottingham Forest","Southampton","Tottenham Hotspur","West Ham United","Wolves",
  ],
  "La Liga": [
    "Real Madrid","Barcelona","Atlético Madrid","Sevilla","Valencia","Villarreal","Real Sociedad","Athletic Club","Real Betis","Celta Vigo","Osasuna","Getafe","Rayo Vallecano","Mallorca","Alavés","Las Palmas","Girona","Leganés","Valladolid","Espanyol",
  ],
  "Serie A": [
    "Inter","Milan","Juventus","Napoli","Roma","Lazio","Atalanta","Fiorentina","Bologna","Torino","Udinese","Genoa","Sassuolo","Lecce","Empoli","Cagliari","Verona","Parma","Venezia","Monza",
  ],
  Bundesliga: [
    "Bayern Munich","Borussia Dortmund","RB Leipzig","Bayer Leverkusen","Stuttgart","Eintracht Frankfurt","Wolfsburg","Borussia Mönchengladbach","Werder Bremen","Freiburg","Hoffenheim","Mainz 05","Augsburg","Union Berlin","Bochum","Heidenheim","Köln","Hertha BSC","Hamburg","Hannover 96",
  ],
};

const TEAM_POOL: Record<Sport, string[]> = {
  Football: [
    "Arsenal","Liverpool","Manchester City","Manchester United","Chelsea","Tottenham Hotspur","Newcastle United","Real Madrid","Barcelona","Atlético Madrid","Sevilla","Valencia","Villarreal","Real Sociedad","Athletic Club","Inter","Milan","Juventus","Napoli","Roma","Lazio","Atalanta","Fiorentina","PSG","Marseille","Lyon","Bayern Munich","Borussia Dortmund","RB Leipzig","Bayer Leverkusen","Ajax","PSV","Benfica","Porto",
  ],
  Basketball: ["Lakers", "Celtics", "Warriors", "Bulls", "Nets"],
  Tennis: ["Player A", "Player B", "Player C", "Player D"],
  "Ice Hockey": ["Rangers", "Penguins", "Maple Leafs", "Canadiens"],
  Baseball: ["Yankees", "Dodgers", "Cubs", "Red Sox"],
  "American Football": ["Patriots", "Cowboys", "Packers", "Giants"],
};

const randTeams = (r: () => number, sport: Sport, competition: string) => {
  const arr = COMP_TEAMS[competition] || TEAM_POOL[sport] || ["Alpha", "Beta", "Gamma", "Delta"];
  const i = Math.floor(r() * arr.length);
  let j = Math.floor(r() * arr.length);
  if (j === i) j = (j + 1) % arr.length;
  return `${arr[i]} vs ${arr[j]}`;
};

const fKey = (e: EventRow) => `${e.competition}|${e.teams}|${e.startTime}`;

// =============================================================================
// Trajanje događaja i countdown do završetka
// =============================================================================
const DUR: Record<Sport, number> = {
  Football: 2 * 3600e3,
  Basketball: 2.5 * 3600e3,
  "Ice Hockey": 2.2 * 3600e3,
  Baseball: 3 * 3600e3,
  "American Football": 3.5 * 3600e3,
  Tennis: 2 * 3600e3,
};
const eventEnd = (e: EventRow) => e.startTime + (DUR[e.sport] || 2 * 3600e3);

// =============================================================================
const OUT = "Konačan ishod" as const;
const GOALS = "Golovi" as const;
const HTFT = "Poluvreme/kraj" as const;
const SPEC = "Specijal" as const;

const R = (r: () => number, a: number, b: number) => Math.round((a + (b - a) * r()) * 100) / 100;

function oddsFootball(m: Market, sel: string, r: () => number) {
  if (m === OUT) {
    if (sel === "X") return R(r, 3.1, 3.9);
    return r() < 0.6 ? R(r, 1.5, 2.2) : R(r, 2.3, 3.5);
  }
  if (m === GOALS) {
    if (sel === "0-2") return R(r, 1.7, 2.3);
    if (sel === "3+") return R(r, 1.6, 2.1);
    if (sel === "4+") return R(r, 2.3, 3.6);
    if (sel === "5+") return R(r, 3.8, 6.5);
    if (sel === "7+") return R(r, 12, 30);
    if (sel === "GG") return R(r, 1.7, 2.2);
    if (sel === "GG3+") return R(r, 2.0, 3.0);
  }
  if (m === HTFT) {
    if (sel === "1-1") return R(r, 2.4, 3.8);
    if (sel === "2-2") return R(r, 2.8, 4.5);
    if (sel === "X-X") return R(r, 4.0, 5.5);
    return R(r, 5.0, 12.0);
  }
  return R(r, 1.5, 3.0);
}

function oddsBasketball(m: Market, _sel: string, _comp: string, r: () => number) {
  if (m === "Poeni") return R(r, 1.75, 2.05);
  return R(r, 1.6, 2.6);
}

function oddsHockey(m: Market, _sel: string, _comp: string, r: () => number) {
  if (m === GOALS) return R(r, 1.8, 2.1);
  if (m === HTFT) return R(r, 4.0, 8.0);
  return R(r, 1.7, 2.7);
}

function marketAwareOdds(r: () => number, sport: Sport, comp: string, market: Market, sel: string) {
  if (sport === "Football") return oddsFootball(market, sel, r);
  if (sport === "Basketball") return oddsBasketball(market, sel, comp, r);
  if (sport === "Ice Hockey") return oddsHockey(market, sel, comp, r);
  return R(r, 1.6, 3.0);
}

// =============================================================================
// SPECIJAL (fudbal) + NBA igrački specijali (poeni +/-)
// =============================================================================
const SPECIAL_POOL = [
  "CRVENI KARTON NA MEČU",
  "PENAL NA MEČU",
  "VAR PONIŠTIO GOL",
  "GOL GLAVOM",
  "GOL VAN 16",
  "GOL IZ SLOBODNOG UDARCA",
  "AUTOGOL",
];

function specialOdds(type: string, r: () => number) {
  const inRange = (lo: number, hi: number) => Math.round((lo + (hi - lo) * r()) * 100) / 100;
  switch (type) {
    case "PENAL NA MEČU": return inRange(2.8, 4.0);
    case "CRVENI KARTON NA MEČU": return inRange(5.0, 9.0);
    case "VAR PONIŠTIO GOL": return inRange(6.0, 12.0);
    case "GOL GLAVOM": return inRange(2.6, 4.2);
    case "GOL VAN 16": return inRange(5.0, 9.0);
    case "GOL IZ SLOBODNOG UDARCA": return inRange(12.0, 25.0);
    case "AUTOGOL": return inRange(9.0, 16.0);
    default: return inRange(3.0, 9.0);
  }
}

const NBA_STARS = [
  "Nikola Jokić","Luka Dončić","Giannis Antetokounmpo","Stephen Curry","LeBron James","Kevin Durant","Shai Gilgeous-Alexander","Jayson Tatum","Joel Embiid","Anthony Davis","Devin Booker","Kawhi Leonard","Jimmy Butler","Damian Lillard","Kyrie Irving","Anthony Edwards","Donovan Mitchell","Paul George","Tyrese Haliburton","Ja Morant","Jamal Murray","Jalen Brunson","Jaylen Brown","Victor Wembanyama","Zion Williamson","Bogdan Bogdanović",
];

const randNBALine = (r: () => number) => {
  const base = 18 + Math.floor(r() * 17);
  return base + 0.5;
};

// =============================================================================
// Synthetika događaja (24h prozor)
// =============================================================================
function synth(seed: number, hours = 24): EventRow[] {
  const r = rnd32(seed);
  const rows: EventRow[] = [];
  const now = Date.now();
  const end = now + hours * 3600e3;

  // broj događaja po takmičenju ~ 2–6 (random)
  for (const comp of COMPS) {
    const sport = COMP2SPORT[comp];
    const n = 2 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const st = Math.floor(now + r() * (end - now));
      const teams = randTeams(r, sport, comp);

      const markets: Market[] =
        sport === "Football"
          ? [OUT, GOALS, HTFT, SPEC]
          : sport === "Basketball"
          ? (["Poeni" as Market, SPEC] as Market[])
          : (["Hendikep", "Ukupno", SPEC] as Market[]);

      let market = pick(r, markets);
      if (market === SPEC && r() < 0.5 && sport !== "Football" && sport !== "Basketball") market = "Hendikep";

      let selection = "";
      if (sport === "Football") {
        if (market === OUT) selection = pick(r, ["1", "X", "2"]);
        else if (market === GOALS) selection = pick(r, ["0-2", "3+", "4+", "5+", "7+", "GG", "GG3+"]);
        else if (market === HTFT) selection = pick(r, ["1-1", "2-2", "X-X", "1-2", "2-1", "1-X", "2-X"]);
        else if (market === SPEC) selection = pick(r, SPECIAL_POOL);
      } else if (sport === "Basketball") {
        if (market === SPEC) {
          const name = pick(r, NBA_STARS);
          const side = pick(r, ["VIŠE", "MANJE"]);
          const line = randNBALine(r).toFixed(1);
          selection = `${name} POENI ${side} ${line}`;
        } else if (market === "Poeni") {
          selection = pick(r, ["VIŠE", "MANJE"]);
        } else {
          selection = pick(r, ["1", "2"]);
        }
      } else {
        if (market === SPEC) market = "Hendikep";
        if (market === "Ukupno") selection = pick(r, ["VIŠE", "MANJE"]);
        else selection = pick(r, ["1", "2"]);
      }

      const odds = market === SPEC && sport === "Football"
        ? specialOdds(selection, r)
        : marketAwareOdds(r, sport, comp, market, selection);

      rows.push({
        id: `${comp}|${teams}|${st}|${market}|${selection}`,
        sport,
        competition: comp,
        teams,
        market,
        selection,
        odds: clamp(Number(odds.toFixed(2)), 1.1, 80),
        startTime: st,
      });
    }
  }
  return rows;
}

// =============================================================================
// Selekcija redova tj. izgradnja tiketa prema targetu (log-target heuristika)
// =============================================================================
function bucket(x: number): "short" | "mid" | "long" {
  if (x < 1.75) return "short";
  if (x < 3.5) return "mid";
  return "long";
}

function closestByLogRatio(cands: EventRow[], want: number) {
  const lw = Math.log(want);
  let best: EventRow | null = null;
  let bestD = Infinity;
  for (const e of cands) {
    if (e.odds < 1.2 || e.odds > 40) continue;
    const d = Math.abs(Math.log(e.odds) - lw);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function buildSeq(
  rows: EventRow[],
  legs: number,
  lo: number,
  hi: number,
  maxPerComp: number,
  maxSpecials: number,
  minSpecials = 0,
): Ticket {
  const used = new Set<string>();
  const usedFx = new Set<string>();
  const compCnt = new Map<string, number>();

  const targetLog = Math.log((lo + hi) / 2);
  let ticket: TicketLeg[] = [];
  let p = 1;

  let spc = 0;
  const add = (e: EventRow) => {
    used.add(e.id);
    usedFx.add(fKey(e));
    inc(compCnt, e.competition);
    if (e.market === SPEC) spc++;
    ticket.push({ event: e });
    p *= e.odds;
  };

  const maxPer = (c: string) => (compCnt.get(c) || 0) < maxPerComp;
  const ok = (e: EventRow) => !used.has(e.id) && !usedFx.has(fKey(e)) && maxPer(e.competition) && (spc + (e.market === SPEC ? 1 : 0)) <= maxSpecials;

  const need = { short: Math.ceil(legs * 0.35), mid: Math.ceil(legs * 0.45), long: Math.ceil(legs * 0.2) };

  minSpecials = Math.max(minSpecials, specBounds(legs).min);
  maxSpecials = Math.min(maxSpecials, specBounds(legs).max);

  const r = rnd32(rows.length ^ legs ^ Math.floor(rows[0]?.odds ?? 17));
  if (r() < 0.08) {
    const hot = rows.filter((e) => e.sport === "Football" && e.market === GOALS && e.selection === "7+" && ok(e));
    if (hot.length) add(pick(r, hot));
  }

  for (let s = ticket.length; s < legs; s++) {
    const rem = legs - s;
    const want = Math.exp((targetLog - Math.log(p)) / rem);

    const allowed: EventRow[] = [];
    for (const e of rows) if (ok(e)) allowed.push(e);
    if (!allowed.length) break;

    let pool = allowed;
    if (need.long > 0 || need.mid > 0 || need.short > 0) {
      const pref = allowed.filter((e) => (need as any)[bucket(e.odds)] > 0);
      if (pref.length) pool = pref;
    }

    const useSpice = need.long <= 0 && need.mid <= 0 && need.short <= 0 && r() < (legs >= 12 ? 0.22 : 0.15);
    if (useSpice) {
      let far: EventRow | null = null;
      let farD = -1;
      const lw = Math.log(want);
      for (const e of pool) {
        if (e.odds < 1.6 || e.odds > 25) continue;
        const d = Math.abs(Math.log(e.odds) - lw);
        if (d > farD) { farD = d; far = e; }
      }
      if (far) {
        add(far);
        (need as any)[bucket(far.odds)]--;
        continue;
      }
    }

    const ch = closestByLogRatio(pool, want);
    if (!ch) break;
    add(ch);
    (need as any)[bucket(ch.odds)]--;
  }

  if (ticket.length < legs) {
    for (const e of rows) {
      if (ticket.length >= legs) break;
      if (ok(e)) add(e);
    }
  }

  if (spc < minSpecials) {
    const err = (x: number) => Math.abs(Math.log(Math.max(1e-12, x)) - targetLog);
    let improved = true;
    while (spc < minSpecials && improved) {
      improved = false;
      let bestGain = 0, bestIdx = -1, bestRep: EventRow | null = null;
      for (let i = 0; i < ticket.length; i++) {
        const old = ticket[i].event;
        if (old.market === SPEC) continue;
        const without = p / old.odds;
        for (const e of rows) {
          if (e.market !== SPEC) continue;
          if (used.has(e.id)) continue;
          const eK = fKey(e);
          if (usedFx.has(eK)) continue;
          const curCnt = compCnt.get(e.competition) || 0;
          const oldAdj = old.competition === e.competition ? 1 : 0;
          const afterComp = curCnt - oldAdj + 1;
          if (afterComp > maxPerComp) continue;
          const p2 = without * e.odds;
          const gain = err(p) - err(p2);
          if (gain > bestGain) { bestGain = gain; bestIdx = i; bestRep = e; }
        }
      }
      if (bestRep && bestIdx >= 0) {
        const old = ticket[bestIdx].event;
        used.delete(old.id); usedFx.delete(fKey(old)); dec(compCnt, old.competition);
        ticket[bestIdx] = { event: bestRep };
        used.add(bestRep.id); usedFx.add(fKey(bestRep)); inc(compCnt, bestRep.competition);
        p = (p / old.odds) * bestRep.odds; spc++; improved = true;
      }
    }
  }

  return { legs: ticket, product: p, inRange: p >= lo && p <= hi };
}

function refineTicket(
  rows: EventRow[],
  base: Ticket,
  lo: number,
  hi: number,
  maxPerComp: number,
  maxSpecials: number,
  minSpecials = 0,
): Ticket {
  const targetLog = Math.log((lo + hi) / 2);
  const err = (x: number) => Math.abs(Math.log(Math.max(1e-12, x)) - targetLog);

  let cur = base.legs.slice();
  let p = base.product;
  const compCnt = new Map<string, number>();
  let spc = 0;
  const fixtures = new Set<string>();

  for (const { event: ev } of cur) {
    inc(compCnt, ev.competition);
    fixtures.add(fKey(ev));
    if (ev.market === SPEC) spc++;
  }

  let improved = true;
  let tries = 0;
  while (improved && tries < 200) {
    improved = false; tries++;

    let bestGain = 0, bestIdx = -1, bestRep: EventRow | null = null, bestSpc = spc;

    for (let i = 0; i < cur.length; i++) {
      const old = cur[i].event;
      const oldK = fKey(old);
      const without = p / old.odds;
      const want = Math.exp(targetLog - Math.log(without));

      for (const e of rows) {
        if (e.id === old.id) continue;
        const eK = fKey(e);
        if (eK !== oldK && fixtures.has(eK)) continue;
        const curCnt = compCnt.get(e.competition) || 0;
        const oldAdj = old.competition === e.competition ? 1 : 0;
        const afterComp = curCnt - oldAdj + 1;
        if (afterComp > maxPerComp) continue;

        const nextSpc = spc - (old.market === SPEC ? 1 : 0) + (e.market === SPEC ? 1 : 0);
        const { min, max } = specBounds(cur.length);
        if (nextSpc > Math.min(max, maxSpecials)) continue;
        if (nextSpc < Math.max(min, minSpecials)) continue;

        const p2 = without * e.odds;
        const gain = err(p) - err(p2);
        if (gain > bestGain) { bestGain = gain; bestIdx = i; bestRep = e; bestSpc = nextSpc; }
      }
    }

    if (bestRep && bestIdx >= 0) {
      const old = cur[bestIdx].event;
      cur[bestIdx] = { event: bestRep };
      p = (p / old.odds) * bestRep.odds;
      spc = bestSpc;
      const oldCnt = (compCnt.get(old.competition) || 0) - 1;
      compCnt.set(old.competition, Math.max(0, oldCnt));
      inc(compCnt, bestRep.competition);
      fixtures.delete(fKey(old));
      fixtures.add(fKey(bestRep));
      improved = true;
      if (p >= lo && p <= hi) break;
    }
  }

  return { legs: cur, product: p, inRange: p >= lo && p <= hi };
}

// =============================================================================
// Ticket helpers
// =============================================================================
function computeTicketProduct(legs: TicketLeg[]): number {
  let p = 1;
  for (const l of legs) p *= l.event.odds;
  return p;
}

function removeLegFromTicket(t: Ticket, index: number): Ticket {
  const legs = t.legs.slice();
  if (index < 0 || index >= legs.length) return t;
  legs.splice(index, 1);
  const product = computeTicketProduct(legs);
  return { legs, product, inRange: product >= TL && product <= TH };
}

function findReplacementCandidate(
  rows: EventRow[],
  t: Ticket,
  index: number,
  maxPerComp: number,
  maxSpecials: number,
  minSpecials = 0,
): EventRow | null {
  const old = t.legs[index]?.event;
  if (!old) return null;
  const legs = t.legs.length;
  const { min, max } = specBounds(legs);
  minSpecials = Math.max(minSpecials, min);
  maxSpecials = Math.min(maxSpecials, max);

  const compCnt = new Map<string, number>();
  let spc = 0;
  const fixtures = new Set<string>();
  t.legs.forEach((L, i) => {
    if (i === index) return;
    inc(compCnt, L.event.competition);
    fixtures.add(fKey(L.event));
    if (L.event.market === SPEC) spc++;
  });

  let best: EventRow | null = null;
  let bestD = Infinity;
  for (const e of rows) {
    if (e.id === old.id) continue;
    if (fKey(e) === fKey(old)) continue;
    if (fixtures.has(fKey(e))) continue;
    if (e.selection === old.selection && e.market === old.market) continue;

    const afterComp = (compCnt.get(e.competition) || 0) + 1;
    if (afterComp > maxPerComp) continue;

    const nextSpc = spc + (e.market === SPEC ? 1 : 0);
    if (nextSpc < minSpecials || nextSpc > maxSpecials) continue;

    const d = Math.abs(Math.log(e.odds) - Math.log(old.odds));
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function replaceLegInTicket(t: Ticket, index: number, repl: EventRow): Ticket {
  const legs = t.legs.slice();
  const old = legs[index]?.event;
  if (!old) return t;
  legs[index] = { event: repl };
  const product = (t.product / old.odds) * repl.odds;
  return { legs, product, inRange: product >= TL && product <= TH };
}

// =============================================================================
// Arhiva — helpers
// =============================================================================
function loadArchive(): ArchiveItem[] {
  try {
    const s = localStorage.getItem(ARCHIVE_KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? (arr as ArchiveItem[]) : [];
  } catch { return []; }
}

function pushArchive(list: ArchiveItem[], item: ArchiveItem, cap = ARCHIVE_CAP): ArchiveItem[] {
  const next = [item, ...list];
  return next.slice(0, cap);
}

// =============================================================================
// UI helpers (badge boje, ikonice, akcije)
// =============================================================================
const TIP_CLASS: Record<string, string> = {
  ["Konačan ishod"]: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Poeni: "bg-sky-50 text-sky-800 border-sky-200",
  Hendikep: "bg-sky-50 text-sky-800 border-sky-200",
  ["Golovi"]: "bg-amber-50 text-amber-800 border-amber-200",
  Ukupno: "bg-amber-50 text-amber-800 border-amber-200",
  ["Poluvreme/kraj"]: "bg-violet-50 text-violet-800 border-violet-200",
  ["Specijal"]: "bg-rose-50 text-rose-800 border-rose-200",
};
const tipCls = (m: string) => TIP_CLASS[m] || "bg-neutral-50 text-neutral-700 border-neutral-200";

const SPORT_ICON: Record<Sport, string> = {
  Football: "⚽", Basketball: "🏀", Tennis: "🎾", "Ice Hockey": "🏒", Baseball: "⚾", "American Football": "🏈",
};
const sportIcon = (s: Sport) => SPORT_ICON[s] || "🎲";

const SPORT_LABEL_SR: Record<Sport, string> = {
  Football: "Fudbal", Basketball: "Košarka", Tennis: "Tenis", "Ice Hockey": "Hokej na ledu", Baseball: "Bejzbol", "American Football": "Američki fudbal",
};
const sportLabelSr = (s: Sport) => SPORT_LABEL_SR[s] || (s as string);

const sportAccentCls = (s: Sport) =>
  ({
    Football: "border-l-emerald-300",
    Basketball: "border-l-sky-300",
    Tennis: "border-l-lime-300",
    "Ice Hockey": "border-l-cyan-300",
    Baseball: "border-l-amber-300",
    "American Football": "border-l-orange-300",
  } as Record<Sport, string>)[s] || "border-l-neutral-200";

const CHIP_BASE =
  "inline-flex items-center rounded-full border px-2 py-[2px] text-xs font-medium select-none";
const SINGL_BTN_BASE =
  "items-center rounded-full border px-2 py-[1px] text-[10px] font-semibold bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200 active:scale-95 transition";
const SWAP_BTN_BASE =
  "items-center rounded-full border px-2 py-[1px] text-[10px] font-semibold bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200 active:scale-95 transition";
const DELETE_BTN_BASE =
  "items-center rounded-full border px-2 py-[1px] text-[10px] font-semibold bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200 active:scale-95 transition";

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

// =============================================================================
// Skeleton UI
// =============================================================================
function SkeletonCard() {
  return (
    <div className="mt-4 space-y-3 animate-pulse">
      <div className="rounded-2xl bg-white ring-1 ring-neutral-200 overflow-hidden shadow-sm">
        <div className="h-10 bg-neutral-100" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className={"h-10 " + (i % 2 ? "bg-neutral-50" : "bg-white")}></div>
        ))}
      </div>
      <div className="rounded-xl p-6 bg-gradient-to-r from-amber-100 via-yellow-100 to-amber-50 border border-amber-300">
        <div className="h-6 w-2/5 bg-amber-200/60 rounded" />
        <div className="mt-2 h-8 w-3/5 bg-amber-200/70 rounded" />
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="h-12 rounded-lg bg-neutral-200 flex-1" />
        <div className="h-12 rounded-lg bg-neutral-300 flex-1" />
      </div>
    </div>
  );
}

// =============================================================================
// Glavna komponenta (bez export default — render je dole)
// =============================================================================
function AIBetGeneratorV2() {
  const { useEffect, useMemo, useRef, useState } = React as any;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [seed, setSeed] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [singleStake, setSingleStake] = useState<number>(() => {
    try { const v = localStorage.getItem("singleStake"); return v ? Number(v) : 100; }
    catch { return 100; }
  });
  const [archive, setArchive] = useState<ArchiveItem[]>(() => {
    try { return loadArchive(); } catch { return []; }
  });
  const [showArchive, setShowArchive] = useState(true);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dark, setDark] = useState(false);
  const [rowsPool, setRowsPool] = useState<EventRow[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") setDark(saved === "dark");
      else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) setDark(true);
    } catch {}
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);
  useEffect(() => {
    try { localStorage.setItem("singleStake", String(singleStake)); } catch {}
  }, [singleStake]);
  useEffect(() => {
    try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive)); } catch {}
  }, [archive]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const gen = () => {
    if (busy) return;
    setBusy(true);
    if (revealTimer.current) { clearInterval(revealTimer.current); revealTimer.current = null; }
    setVisibleCount(0); setRevealing(false);

    const baseSeed = Date.now() + seed;
    const r = rnd32(baseSeed);
    const legs = LEGS_MIN + Math.floor(r() * (LEGS_MAX - LEGS_MIN + 1));

    let chosenTicket: Ticket | null = null;
    let usedRows: EventRow[] = [];

    for (let i = 0; i <= TRIES; i++) {
      const rows = synth(baseSeed + i, 24);
      const { min } = specBounds(legs);
      const base = buildSeq(rows, legs, TL, TH, MAX_PER_COMP, /*maxSpec*/ 3, /*minSpec*/ min);
      const t = base.inRange ? base : refineTicket(rows, base, TL, TH, MAX_PER_COMP, /*maxSpec*/ 3, /*minSpec*/ min);
      if (t.inRange) { chosenTicket = t; usedRows = rows; break; }
      if (i === TRIES) { chosenTicket = t; usedRows = rows; }
    }

    setSeed((s) => s + 1);
    setTicket(chosenTicket!);
    setRowsPool(usedRows);
    setRevealing(true);

    let i = 0;
    revealTimer.current = setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (!chosenTicket?.legs?.length || i >= chosenTicket.legs.length) {
        if (revealTimer.current) clearInterval(revealTimer.current);
        revealTimer.current = null;
        setRevealing(false);
      }
    }, 90);

    setBusy(false);
  };

  React.useEffect(() => { if (!ticket && !busy) gen(); }, []); // auto-prvi tiket

  const toast = (msg: string) => {
    setNotice(msg); setShowToast(true);
    setTimeout(() => setShowToast(false), 2200);
    setTimeout(() => setNotice(""), 2400);
  };

  const logSingleToArchive = (ev: EventRow, stake: number, potential: number) => {
    const item: ArchiveSingle = {
      kind: "single",
      id: "SING-" + Date.now().toString(36).toUpperCase(),
      at: Date.now(),
      sport: ev.sport, competition: ev.competition, teams: ev.teams,
      market: ev.market, selection: ev.selection, odds: ev.odds,
      stake, potentialPayout: potential,
    };
    setArchive((prev) => pushArchive(prev, item));
  };

  const playSingle = async (ev: EventRow) => {
    const potential = Math.round(singleStake * ev.odds);
    const payload = {
      single: true, stake: singleStake, stakeCurrency: "RSD",
      sport: ev.sport, competition: ev.competition, teams: ev.teams,
      market: ev.market, selection: ev.selection, odds: ev.odds,
      eventStart: ev.startTime, potentialPayout: potential,
    };
    await copy(JSON.stringify(payload, null, 2));
    logSingleToArchive(ev, singleStake, potential);
    toast(`SINGL UPLAĆEN (${fmtEu(singleStake)} RSD) • Potencijalno: ${fmtEu(potential)} RSD`);
  };

  const removeLeg = (idx: number) => {
    if (!ticket) return;
    const t2 = removeLegFromTicket(ticket, idx);
    setTicket(t2);
    setVisibleCount((vc) => Math.min(vc, t2.legs.length));
    toast(`Događaj obrisan • Preostalo parova: ${t2.legs.length}`);
  };

  const changeLeg = (idx: number) => {
    if (!ticket) return;
    const old = ticket.legs[idx]?.event;
    let cand = findReplacementCandidate(rowsPool, ticket, idx, MAX_PER_COMP, /*maxSpec*/ 3, /*minSpec*/ specBounds(ticket.legs.length).min);

    if (!cand) {
      for (let k = 0; k < 3 && !cand; k++) {
        const extraRows = synth((Date.now() ^ seed ^ (idx + 1) ^ k) >>> 0, 24);
        cand = findReplacementCandidate(extraRows, ticket, idx, MAX_PER_COMP, 3, specBounds(ticket.legs.length).min);
        if (cand) setRowsPool(extraRows);
      }
    }

    if (!cand) { toast("Nema odgovarajuće zamene za ovaj događaj."); return; }

    const t2 = replaceLegInTicket(ticket, idx, cand);
    setTicket(t2);
    setVisibleCount((vc) => Math.max(vc, idx + 1));
    toast(`Događaj PROMENJEN • kvota ${old.odds.toFixed(2)} → ${cand.odds.toFixed(2)}`);
  };

  const pay = async () => {
    if (!ticket) return;
    const legs = ticket.legs.length;
    const { base, bonus, total, pct } = computePayout(ticket.product, legs, STAKE);
    const slipId = "SLIP-" + Date.now().toString(36).toUpperCase();
    const payload = {
      slipId, stake: STAKE, stakeCurrency: "RSD",
      product: Math.round(ticket.product),
      payout: total, payoutBeforeBonus: base, bonusPct: pct, bonusAmount: bonus, payoutWithBonus: total, payoutCurrency: "RSD",
      legs: ticket.legs.map((l, i) => ({
        i, sport: l.event.sport, competition: l.event.competition, teams: l.event.teams,
        market: l.event.market, selection: l.event.selection, odds: l.event.odds,
      })),
    };
    await copy(JSON.stringify(payload, null, 2));

    const archItem: ArchiveTicket = {
      kind: "ticket", id: slipId, at: Date.now(), legs,
      product: Math.round(ticket.product), stake: STAKE,
      payoutBeforeBonus: base, bonusPct: pct, bonusAmount: bonus, payoutWithBonus: total,
      items: ticket.legs.map((l) => ({
        sport: l.event.sport, competition: l.event.competition, teams: l.event.teams,
        market: l.event.market, selection: l.event.selection, odds: l.event.odds,
      })),
    };
    setArchive((prev) => pushArchive(prev, archItem));

    toast("Uspešno ste uplatili tiket. SREĆNO!");
    setTimeout(() => gen(), 600);
  };

  const payout = React.useMemo(() => {
    if (!ticket) return { base: 0, bonus: 0, total: 0, pct: 0, legs: 0 };
    const legs = ticket.legs.length;
    const { base, bonus, total, pct } = computePayout(ticket.product, legs, STAKE);
    return { base, bonus, total, pct, legs };
  }, [ticket]);

  const lastEnd = React.useMemo(() => {
    if (!ticket) return Date.now();
    let m = 0;
    for (const l of ticket.legs) m = Math.max(m, eventEnd(l.event));
    return m;
  }, [ticket]);

  const left = Math.max(0, lastEnd - now);

  const btnBase =
    "flex-1 rounded-lg px-3 py-3 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.99] transition";
  const payBtnClass =
    btnBase + " bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-600/20 focus-visible:ring-emerald-400";
  const genBtnClass = React.useMemo(
    () =>
      btnBase + " " + (busy || revealing ? "bg-neutral-400" : "bg-gradient-to-r from-neutral-900 to-black ") + " focus-visible:ring-neutral-400",
    [busy, revealing],
  );

  const appCls =
    "mx-auto max-w-3xl p-5 bg-gradient-to-br from-slate-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 min-h-screen relative text-slate-900 dark:text-slate-100 transition-colors duration-300 ease-out antialiased";

  return (
    <div className={dark ? "dark" : ""}>
      <div className={appCls}>
        <header className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-cyan-500 text-white p-4 sm:p-5 shadow-lg ring-1 ring-white/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 group">
              <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-white/10 ring-1 ring-white/30 flex items-center justify-center">🤖</div>
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight">
                AI BET GENERATOR <span className="opacity-80">(DEMO)</span>
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden md:inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-white/10 ring-1 ring-white/30">
                Ulog tiketa: {STAKE} RSD
              </span>
              <button
                onClick={() => setDark((d) => !d)}
                aria-label="Promeni temu"
                aria-pressed={dark}
                title={dark ? "Svetli režim" : "Tamni režim"}
                className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/10 ring-1 ring-white/30 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20 transition-colors"
              >
                {dark ? "☀️" : "🌙"}
              </button>
            </div>
          </div>
        </header>

        {/* Toast */}
        {showToast && notice && (
          <div role="status" aria-live="polite" className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
            <div className="rounded-full bg-emerald-600 text-white px-4 py-2 shadow-lg ring-1 ring-emerald-300 text-sm sm:text-base flex items-center gap-2">
              <span>✅</span><span>{notice}</span>
            </div>
          </div>
        )}

        {!ticket && busy && <SkeletonCard />}

        {ticket && (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-neutral-200 dark:ring-slate-800 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-neutral-100 dark:bg-slate-800 sticky top-0 z-10">
                  <tr>
                    <th className="p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-700 dark:text-slate-300">Događaj</th>
                    <th className="p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-700 dark:text-slate-300">TIP</th>
                    <th className="p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-neutral-700 dark:text-slate-300">Kvota</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.legs.slice(0, visibleCount).map((l, i) => (
                    <tr key={i}
                      className={"odd:bg-white even:bg-neutral-50 dark:odd:bg-slate-900 dark:even:bg-slate-800 border-l-4 hover:bg-neutral-100 dark:hover:bg-slate-800 transition-colors " + sportAccentCls(l.event.sport)}>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg" title={sportLabelSr(l.event.sport)}>{sportIcon(l.event.sport)}</span>
                          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-neutral-100 text-neutral-700 text-xs font-semibold">{i + 1}</span>
                          <div>
                            <div className="font-medium">{l.event.teams}</div>
                            <div className="text-neutral-600 dark:text-neutral-400 text-xs">{l.event.competition}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-2 text-left">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={CHIP_BASE + " " + tipCls(l.event.market)}>{l.event.market}</span>
                          <span className={CHIP_BASE + " bg-neutral-100 text-neutral-800 border-neutral-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700"}>{l.event.selection}</span>
                        </div>
                      </td>
                      <td className="p-2 font-mono">
                        <div className="flex items-center justify-end gap-1">
                          <span>{l.event.odds.toFixed(2)}</span>
                          <button onClick={() => playSingle(l.event)} title="Odigraj singl — singl ne utiče na glavni tiket" className={`inline-flex md:hidden ${SINGL_BTN_BASE}`}>ODIGRAJ SINGL</button>
                          <button onClick={() => playSingle(l.event)} title="Odigraj singl — singl ne utiče na glavni tiket" className={`hidden md:inline-flex ${SINGL_BTN_BASE}`}>ODIGRAJ SINGL</button>
                          <button onClick={() => changeLeg(i)} title="Promeni događaj i tip — pokušaće da zadrži sličnu kvotu" className={`hidden md:inline-flex ${SWAP_BTN_BASE}`}>PROMENI DOGAĐAJ</button>
                          <button onClick={() => changeLeg(i)} title="Promeni događaj i tip — pokušaće da zadrži sličnu kvotu" className={`inline-flex md:hidden ${SWAP_BTN_BASE}`}>PROMENI</button>
                          <button onClick={() => removeLeg(i)} title="Obriši događaj sa tiketa" className={`hidden md:inline-flex ${DELETE_BTN_BASE}`}>OBRIŠI DOGAĐAJ</button>
                          <button onClick={() => removeLeg(i)} title="Obriši događaj sa tiketa" className={`inline-flex md:hidden ${DELETE_BTN_BASE}`}>OBRIŠI</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl p-4 bg-gradient-to-r from-amber-100 via-yellow-100 to-amber-50 border border-amber-300 dark:bg-gradient-to-r dark:from-slate-800 dark:via-slate-800 dark:to-slate-900 dark:border-slate-700">
              <div className="text-xs uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-200">Potencijalna isplata</div>
              <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                <div className="text-3xl sm:text-4xl font-extrabold drop-shadow-sm text-amber-900 dark:text-amber-100">
                  <span className="motion-safe:animate-pulse">{fmtEu(payout.total)}</span>
                  <span className="text-lg font-bold ml-1">DINARA</span>
                </div>
                <span className="text-xs text-amber-800 bg-amber-200 px-2 py-0.5 rounded-full">Uplata: {STAKE} RSD</span>
                <span className="text-xs text-emerald-900 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">x{ticket ? fmtEu(Math.round(ticket.product)) : 0}</span>
                <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-900 border-emerald-300 px-2 py-0.5 rounded-full">BONUS NA BROJ PAROVA: +{payout.pct}%</span>
              </div>
              <div className="mt-1 text-xs text-amber-700 font-mono flex flex-wrap gap-3 items-center">
                <span>Ukupna kvota: {ticket ? fmtEu(Math.round(ticket.product)) : 0}</span>
                <span className="text-emerald-900 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">Bonus iznos: {fmtEu(payout.bonus)} RSD</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 text-amber-900 px-2 py-0.5">⏳ {fmtLeft(left)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-700 dark:text-neutral-300">Singl ulog:</label>
              <input type="number" min={10} step={10} value={singleStake} onChange={(e) => setSingleStake(Number(e.target.value) || 0)}
                className="w-24 rounded-md border border-neutral-300 bg-white dark:bg-slate-900 dark:border-slate-700 px-2 py-1 text-sm" />
              <span className="text-xs text-neutral-500">RSD</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={pay} disabled={busy || revealing} className={payBtnClass}>UPLATI TIKET!</button>
              <button onClick={gen} disabled={busy || revealing} className={genBtnClass}>{busy ? "Radim…" : "GENERIŠI NOVI TIKET"}</button>
            </div>

            {/* ARHIVA */}
            <div className="mt-4 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-neutral-200 dark:ring-slate-800 overflow-hidden">
              <div className="px-3 py-2 bg-neutral-100 dark:bg-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🗄️</span>
                  <div className="text-sm font-semibold">Arhiva (poslednjih 50)</div>
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">{archive.length} stavki</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowArchive((v) => !v)}
                    className="text-xs px-2 py-1 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 dark:bg-slate-900 dark:border-slate-700"
                    title={showArchive ? "Sakrij arhivu" : "Prikaži arhivu"}>{showArchive ? "Sakrij" : "Prikaži"}</button>
                  <button onClick={() => setArchive([])}
                    className="text-xs px-2 py-1 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" title="Očisti arhivu">Očisti</button>
                </div>
              </div>

              {showArchive && (
                <div className="divide-y divide-neutral-200 dark:divide-slate-800">
                  {archive.length === 0 ? (
                    <div className="p-3 text-sm text-neutral-600 dark:text-neutral-400">Još nema uplaćenih tiketa ili singlova.</div>
                  ) : (
                    archive.map((it, idx) => (
                      <div key={(it as any).id + idx} className="p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xl" title={it.kind === "ticket" ? "Tiket" : "Singl"}>{it.kind === "ticket" ? "🎟️" : "🎯"}</span>
                          <div className="min-w-0">
                            {it.kind === "single" ? (
                              <div className="truncate">
                                <span className="font-semibold">SINGL</span> • {it.teams}
                                <span className="ml-2 inline-flex items-center gap-1">
                                  <span className={CHIP_BASE + " " + tipCls(it.market)}>{it.market}</span>
                                  <span className={CHIP_BASE + " bg-neutral-100 border-neutral-300"}>{it.selection}</span>
                                </span>
                              </div>
                            ) : (
                              <div className="truncate">
                                <span className="font-semibold">TIKET</span> • {it.legs} parova • x{fmtEu(Math.round(it.product))}
                              </div>
                            )}
                            <div className="text-xs text-neutral-600 dark:text-neutral-400 truncate">{fmtDateTime(it.at)}</div>
                          </div>
                        </div>
                        <div className="text-right whitespace-nowrap text-sm">
                          {it.kind === "single" ? (
                            <div className="space-x-2">
                              <span className="font-mono">@ {it.odds.toFixed(2)}</span>
                              <span>Ulog: {fmtEu(it.stake)} RSD</span>
                              <span className="font-semibold">Potencijalno: {fmtEu(it.potentialPayout)} RSD</span>
                            </div>
                          ) : (
                            <div className="space-x-2">
                              <span>Ulog: {fmtEu(it.stake)} RSD</span>
                              <span>Bonus: +{it.bonusPct}% ({fmtEu(it.bonusAmount)} RSD)</span>
                              <span className="font-semibold">Isplata: {fmtEu(it.payoutWithBonus)} RSD</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Lightweight tests (console) — run in dev only
// =============================================================================
(function runLightweightTests() {
  const isBrowser = typeof window !== "undefined";
  const allow = isBrowser ? (window as any).__AIBET_TESTS__ !== false : true;
  if (!allow) return;

  const log = console.log;
  const err = console.error;
  const assert = (cond: any, msg: string) => { if (!cond) throw new Error(msg); };
  const test = (name: string, fn: () => void) => {
    try { fn(); log(`✅ ${name}`); }
    catch (e) { err(`❌ ${name}:`, e); }
  };

  test("bonusPctFor thresholds", () => {
    assert(bonusPctFor(6) === 0, "<7 legs should be 0% bonus");
    assert(bonusPctFor(7) === 12, "7 legs should be 12% bonus");
    assert(bonusPctFor(20) === 80, "20 legs should be 80% bonus");
  });

  test("specBounds thresholds", () => {
    const a = specBounds(9);
    const b = specBounds(10);
    assert(a.min === 0 && a.max === 2, "<10 legs spec bounds");
    assert(b.min === 1 && b.max === 3, ">=10 legs spec bounds");
  });

  test("computePayout correctness sample", () => {
    const product = 1_000_000; const stake = 10; const legs = 7;
    const { base, bonus, total, pct } = computePayout(product, legs, stake);
    const expectedBase = product * stake;
    const expectedBonus = Math.round((expectedBase * 12) / 100);
    const expectedTotal = expectedBase + expectedBonus;
    assert(pct === 12, "pct should be 12 for 7 legs");
    assert(base === expectedBase, "base payout calc");
    assert(bonus === expectedBonus, "bonus payout calc");
    assert(total === expectedTotal, "total payout calc");
  });

  test("build+refine respects constraints and range", () => {
    const legs = 12;
    const rows = synth(12345, 24);
    const { min } = specBounds(legs);
    const base = buildSeq(rows, legs, TL, TH, MAX_PER_COMP, 3, min);
    const t = base.inRange ? base : refineTicket(rows, base, TL, TH, MAX_PER_COMP, 3, min);

    assert(t.legs.length === legs, "exact number of legs");
    assert(t.product > 0, "product positive");

    const byComp = new Map<string, number>();
    for (const l of t.legs) byComp.set(l.event.competition, (byComp.get(l.event.competition) || 0) + 1);
    for (const [comp, cnt] of byComp) assert(cnt <= MAX_PER_COMP, `max per comp breached: ${comp}=${cnt}`);

    const seen = new Set<string>();
    for (const l of t.legs) {
      const k = `${l.event.competition}|${l.event.teams}|${l.event.startTime}`;
      assert(!seen.has(k), `duplicate fixture ${k}`);
      seen.add(k);
    }

    const minSpec = specBounds(legs).min;
    const spc = t.legs.filter((x) => x.event.market === SPEC).length;
    assert(spc >= minSpec, `should have at least ${minSpec} specials`);

    assert(t.product >= TL * 0.98 && t.product <= TH * 1.02, "product near target range");

    const { base: b, bonus: bn, total } = computePayout(t.product, t.legs.length, STAKE);
    assert(total === b + bn, "payout base+bonus consistency");
  });

  test("removeLegFromTicket reduces product and bonus tier", () => {
    const rows = synth(98765, 24);
    const base = buildSeq(rows, 10, TL, TH, MAX_PER_COMP, 3, specBounds(10).min);
    const t = base.inRange ? base : refineTicket(rows, base, TL, TH, MAX_PER_COMP, 3, specBounds(10).min);
    const firstOdds = t.legs[0].event.odds;
    const t2 = removeLegFromTicket(t, 0);

    const expected = t.product / firstOdds;
    const eps = 1e-9;
    const diff = Math.abs(t2.product - expected);
    assert(diff <= eps, `product division mismatch: diff=${diff}`);

    const beforePct = bonusPctFor(10);
    const afterPct = bonusPctFor(t2.legs.length);
    assert(beforePct === 28 && afterPct === 22, `bonus tiers unexpected: before=${beforePct}, after=${afterPct}`);
  });

  test("fmtEu formatting", () => {
    assert(fmtEu(1_000_000) === "1.000.000", "fmtEu million format");
    assert(fmtEu(12_345.67, 2) === "12.345,67", "fmtEu decimals format");
    assert(fmtEu(-987_654) === "-987.654", "fmtEu negative format");
  });

  test("no American market labels in synth", () => {
    const rows = synth(33333, 24);
    for (const r of rows) {
      assert(r.market !== ("Moneyline" as any), "Moneyline should not appear");
      assert(r.market !== ("Spread" as any), "Spread label should be localized to Hendikep");
      assert(r.market !== ("Total" as any), "Total label should be localized to Ukupno");
    }
  });

  test("sportLabelSr mapping", () => {
    const m: [Sport, string][] = [
      ["Football", "Fudbal"],["Basketball", "Košarka"],["Tennis", "Tenis"],["Ice Hockey", "Hokej na ledu"],["Baseball", "Bejzbol"],["American Football", "Američki fudbal"],
    ];
    for (const [en, sr] of m) {
      assert(sportLabelSr(en) === sr, `label for ${en} should be ${sr}`);
    }
  });

  test("findReplacementCandidate + replaceLegInTicket keeps odds close & constraints", () => {
    const rows = synth(22222, 24);
    const base = buildSeq(rows, 10, TL, TH, MAX_PER_COMP, 3, specBounds(10).min);
    const t = base.inRange ? base : refineTicket(rows, base, TL, TH, MAX_PER_COMP, 3, specBounds(10).min);

    const idx = t.legs.findIndex((L) => L.event.market !== SPEC);
    const pickIndex = idx >= 0 ? idx : 0;
    const old = t.legs[pickIndex].event;

    const cand = findReplacementCandidate(rows, t, pickIndex, MAX_PER_COMP, 3, specBounds(t.legs.length).min);
    assert(!!cand, "should find candidate");
    if (!cand) return;

    assert(fKey(cand) !== fKey(old), "should be different fixture");
    assert(cand.selection !== old.selection || cand.market !== old.market, "should be different tip/market");

    const ratio = cand.odds / old.odds;
    assert(ratio > 0.7 && ratio < 1.3, `odds not close enough: ratio=${ratio}`);

    const t2 = replaceLegInTicket(t, pickIndex, cand);

    const byComp = new Map<string, number>();
    for (const L of t2.legs) byComp.set(L.event.competition, (byComp.get(L.event.competition) || 0) + 1);
    for (const [, cnt] of byComp) assert(cnt <= MAX_PER_COMP, "max per comp after replace");

    const seen = new Set<string>();
    for (const L of t2.legs) {
      const k = `${L.event.competition}|${L.event.teams}|${L.event.startTime}`;
      assert(!seen.has(k), "no duplicate fixtures after replace");
      seen.add(k);
    }

    const bounds = specBounds(t2.legs.length);
    const spc = t2.legs.filter((x) => x.event.market === SPEC).length;
    assert(spc >= bounds.min && spc <= bounds.max, "specials bounds respected after replace");

    const expectedProduct = (t.product / old.odds) * cand.odds;
    const diff = Math.abs(t2.product - expectedProduct);
    assert(diff <= 1e-12, "product update exact");
  });

  test("archive push caps at 50 and keeps newest first", () => {
    let acc: ArchiveItem[] = [];
    for (let i = 0; i < 55; i++) {
      const item: ArchiveSingle = {
        kind: "single", id: "SING-" + i, at: i,
        sport: "Football", competition: "La Liga", teams: "A vs B",
        market: "Konačan ishod", selection: "1", odds: 1.5, stake: 100, potentialPayout: 150,
      };
      acc = pushArchive(acc, item);
    }
    (function assert(cond: any, msg: string){ if(!cond) throw new Error(msg); })(acc.length === 50, "archive must be capped to 50");
  });
})();

// ===== MOUNT aplikacije na #root =====
const rootEl = document.getElementById("root") as HTMLElement;
ReactDOM.createRoot(rootEl).render(<AIBetGeneratorV2 />);
