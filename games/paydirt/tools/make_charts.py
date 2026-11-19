"""Build Paydirt-style team charts from a season of nflverse play-by-play.

    python3 make_charts.py play_by_play_2025.csv.gz 2025 > ../teams.js

Data: https://github.com/nflverse/nflverse-data/releases (pbp). Regular season only.

Chart layout follows the original cards so real cards can be typed into the same format:
  off[col] -> 30 entries for offensive dice totals 10..39
     cols '1'..'9' plays, 'B' breakaway, 'QT' QB trapped,
     'KO' kickoff, 'KR' kickoff return, 'P' punt, 'PR' punt return, 'IR' interception return, 'FG'
  def[A..F][play] -> 5 entries for defensive dice totals 1..5
  fumRec -> offensive totals on which the fumbling team recovers
  patMiss -> offensive totals on which the extra point is no good

Entry strings: '5' '-2' '(3)' '[0]' 'INC' 'INT 14' 'F -1' 'QT' 'B' 'PI 23' 'OFF 5' 'DEF 15' 'TD'
  '7*' out of bounds; punts: '44†' downed/out, '41*' fair catch, 'TB', 'BLK'; kickoffs: 'TB', '62', 'OB'
"""
import sys, json, math, hashlib
import pandas as pd
import numpy as np

SRC, SEASON = sys.argv[1], int(sys.argv[2])
df = pd.read_csv(SRC, low_memory=False)
df = df[df.season_type == 'REG']

NAMES = {
 'ARI': ('Arizona', 'Cardinals', '#97233F'), 'ATL': ('Atlanta', 'Falcons', '#A71930'), 'BAL': ('Baltimore', 'Ravens', '#241773'),
 'BUF': ('Buffalo', 'Bills', '#00338D'), 'CAR': ('Carolina', 'Panthers', '#0085CA'), 'CHI': ('Chicago', 'Bears', '#0B162A'),
 'CIN': ('Cincinnati', 'Bengals', '#FB4F14'), 'CLE': ('Cleveland', 'Browns', '#311D00'), 'DAL': ('Dallas', 'Cowboys', '#003594'),
 'DEN': ('Denver', 'Broncos', '#FB4F14'), 'DET': ('Detroit', 'Lions', '#0076B6'), 'GB': ('Green Bay', 'Packers', '#203731'),
 'HOU': ('Houston', 'Texans', '#03202F'), 'IND': ('Indianapolis', 'Colts', '#002C5F'), 'JAX': ('Jacksonville', 'Jaguars', '#006778'),
 'KC': ('Kansas City', 'Chiefs', '#E31837'), 'LA': ('Los Angeles', 'Rams', '#003594'), 'LAC': ('Los Angeles', 'Chargers', '#0080C6'),
 'LV': ('Las Vegas', 'Raiders', '#000000'), 'MIA': ('Miami', 'Dolphins', '#008E97'), 'MIN': ('Minnesota', 'Vikings', '#4F2683'),
 'NE': ('New England', 'Patriots', '#002244'), 'NO': ('New Orleans', 'Saints', '#D3BC8D'), 'NYG': ('New York', 'Giants', '#0B2265'),
 'NYJ': ('New York', 'Jets', '#125740'), 'PHI': ('Philadelphia', 'Eagles', '#004C54'), 'PIT': ('Pittsburgh', 'Steelers', '#FFB612'),
 'SEA': ('Seattle', 'Seahawks', '#002244'), 'SF': ('San Francisco', '49ers', '#AA0000'), 'TB': ('Tampa Bay', 'Buccaneers', '#D50A0A'),
 'TEN': ('Tennessee', 'Titans', '#4B92DB'), 'WAS': ('Washington', 'Commanders', '#5A1414'),
}

# ---------- dice ----------
# Avalon Hill offensive dice: tens die 1,2,2,3,3,3; ones dice 0-5 and 0,0,1,2,3,4 -> totals 10..39
BLACK = {1: 1/6, 2: 2/6, 3: 3/6}
WHITE2 = {}
for a in range(6):
    for b in (0, 0, 1, 2, 3, 4):
        WHITE2[a + b] = WHITE2.get(a + b, 0) + 1/36
ROWS = list(range(10, 40))
PROB = {}
for k, pk in BLACK.items():
    for s, ps in WHITE2.items():
        PROB[10*k + s] = PROB.get(10*k + s, 0) + pk*ps
RED = {0: 3/6, 1: 2/6, 2: 1/6}; GREEN = {1: 3/6, 2: 2/6, 3: 1/6}
DPROB = {}
for r, pr in RED.items():
    for g, pg in GREEN.items(): DPROB[r + g] = DPROB.get(r + g, 0) + pr*pg

def seeded(key):
    h = hashlib.sha256(key.encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], 'little'))

def shuffled_rows(key, rows=None):
    rows = list(rows if rows is not None else ROWS)
    seeded(key).shuffle(rows)
    return rows

def pick_rows(mass, avail, key):
    """Choose rows from avail whose probability sums close to mass, preferring rare rows."""
    chosen, need = [], mass
    pool = sorted(avail, key=lambda r: (PROB[r], seeded(key + str(r)).random()))
    while need > 0.004:
        cands = [r for r in pool if r not in chosen and PROB[r] <= need * 1.45]
        if not cands: break
        r = max(cands, key=lambda r: PROB[r] - abs(need - PROB[r]) * 0.01)  # biggest that fits
        chosen.append(r); need -= PROB[r]
    return chosen

# ---------- weighted outcome samples ----------
# an outcome is a tuple: ('Y', yards, oob) ('INC',) ('INT', depth) ('F', yards) ('QT',) ('B',) ('PI', yds) ('OFF', yds) ('DEF', yds)
def mix(team, league, k):
    """team/league: lists of outcomes. Returns list of (outcome, weight), team shrunk toward league by k pseudo-plays."""
    out = [(o, 1.0) for o in team]
    if league:
        w = k / len(league)
        out += [(o, w) for o in league]
    tot = sum(w for _, w in out)
    return [(o, w / tot) for o, w in out]

SPECIAL = ['INT', 'F', 'QT', 'B', 'PI', 'OFF', 'DEF', 'TD', 'BLK', 'TB', 'OB']

def fmt(o):
    t = o[0]
    if t == 'Y': return f"{int(o[1])}" + ('*' if o[2] else '')
    if t in ('INC', 'QT', 'B', 'TD', 'BLK', 'TB', 'OB'): return t
    if t == 'INT': return f"INT {int(o[1])}"
    if t == 'F': return f"F {int(o[1]):+d}" if o[1] else 'F 0'
    if t in ('PI', 'OFF', 'DEF'): return f"{t} {int(o[1])}"
    raise ValueError(o)

def build_column(dist, key, oob_mark=True):
    """dist: list of (outcome, weight) summing to 1 -> 30 strings for rows 10..39."""
    col = {}
    avail = list(ROWS)
    # special results get their own rows (rare rows first, as on the cards)
    groups = {}
    for o, w in dist:
        if o[0] in SPECIAL: groups.setdefault(o[0], []).append((o, w))
    for t in sorted(groups, key=lambda t: -sum(w for _, w in groups[t])):
        g = groups[t]; mass = sum(w for _, w in g)
        rows = pick_rows(mass, avail, key + t)
        if not rows: continue
        vals = sorted(g, key=lambda x: x[0][1] if len(x[0]) > 1 else 0)
        cum, i, acc = 0, 0, 0
        tot = sum(PROB[r] for r in rows)
        for r in rows:  # quantile within the group
            target = (acc + PROB[r] / 2) / tot
            acc += PROB[r]
            c = 0
            for o, w in vals:
                c += w / mass
                if c >= target: break
            if t in ('PI', 'OFF', 'DEF'):
                o = (t, max(5, int(round(o[1] / 5.0) * 5)) if t != 'PI' else max(1, int(o[1])))
            col[r] = fmt(o)
        avail = [r for r in avail if r not in rows]
    # regular results by bin means over the remaining rows in a shuffled order
    reg = [(o, w) for o, w in dist if o[0] not in SPECIAL]
    rmass = sum(w for _, w in reg)
    reg.sort(key=lambda x: (-999 if x[0][0] == 'INC' else x[0][1]))
    order = shuffled_rows(key, avail)
    totp = sum(PROB[r] for r in order)
    # assign sorted bins to rows sorted by shuffled order
    edges, acc = [], 0
    for r in order:
        edges.append((r, acc / totp, (acc + PROB[r]) / totp)); acc += PROB[r]
    # walk reg distribution
    cum = []
    c = 0
    for o, w in reg:
        cum.append((c, c + w / rmass, o)); c += w / rmass
    oobs = {}
    for r, u0, u1 in edges:
        inc = 0; ysum = 0; ywt = 0; oob = 0
        for a, b, o in cum:
            lo, hi = max(a, u0), min(b, u1)
            if hi <= lo: continue
            m = hi - lo
            if o[0] == 'INC': inc += m
            else: ysum += o[1] * m; ywt += m; oob += m if o[2] else 0
        if inc > (u1 - u0) / 2 or ywt == 0: col[r] = 'INC'
        else:
            y = int(round(ysum / ywt))
            col[r] = f"{y}" + ('*' if oob_mark and oob > ywt / 2 else '')
    return [col[r] for r in ROWS]

# ---------- league helpers ----------
pl = df[df.play_type.isin(['run', 'pass'])].copy()
pl = pl[pl.posteam.notna()]

def pen_outcome(row):
    if row.get('penalty') != 1 or pd.isna(row.get('penalty_team')): return None
    yds = row['penalty_yards'] if not pd.isna(row['penalty_yards']) else 5
    if row['penalty_type'] == 'Defensive Pass Interference':
        return ('PI', max(1, yds))
    if row['penalty_team'] == row['posteam']: return ('OFF', yds)
    return ('DEF', yds)

def play_outcome(row, long_run=False):
    """Outcome for a run/pass snap (no penalty)."""
    y = row.yards_gained if not pd.isna(row.yards_gained) else 0
    oob = row.out_of_bounds == 1
    if row.fumble_lost == 1 or (row.fumble == 1 and row.fumble_out_of_bounds != 1): return ('F', y)
    if row.play_type == 'pass':
        if row.interception == 1: return ('INT', max(0, row.air_yards if not pd.isna(row.air_yards) else 10))
        if row.complete_pass == 1: return ('Y', y, oob)
        return ('INC',)
    if long_run and y >= 15: return ('B',)
    return ('Y', y, oob)

# penalties (all snaps incl. no_play), by offense
snaps = df[df.play_type.isin(['run', 'pass', 'no_play']) & df.posteam.notna()]
pens = snaps[(snaps.penalty == 1)]
LEAGUE_SNAPS = len(snaps)

def classify_pass(r):
    a = r.air_yards
    if pd.isna(a): return None
    if a <= 0: return '5'
    if r.pass_location in ('left', 'right') and 3 <= a <= 18 and r.yards_after_catch is not None: side = True
    else: side = False
    if a <= 9: return '6s' if side else '6'
    if a <= 19: return '7s' if side else '7'
    return '8'

pl['pcls'] = pl.apply(lambda r: classify_pass(r) if r.play_type == 'pass' and r.sack != 1 else None, axis=1)
runs = pl[(pl.play_type == 'run') & (pl.qb_scramble != 1) & (pl.penalty != 1)]
def run_cls(r):
    if r.run_location == 'middle' or r.run_gap == 'guard': return '1'
    if r.run_gap == 'tackle': return '2'
    if r.run_gap == 'end': return '3'
    return '1'
runs = runs.assign(rcls=runs.apply(run_cls, axis=1))
passes = pl[(pl.play_type == 'pass') & (pl.sack != 1) & (pl.penalty != 1) & pl.pcls.notna()]
drop = pl[(pl.qb_dropback == 1)]
qt_plays = pl[((pl.sack == 1) | (pl.qb_scramble == 1)) & (pl.penalty != 1)]

def col_samples(frame):
    return [play_outcome(r, long_run=True) for r in frame.itertuples()]

def col_samples_pass(frame):
    return [play_outcome(r) for r in frame.itertuples()]

LEAGUE = {
 '1': col_samples(runs[runs.rcls == '1']), '2': col_samples(runs[runs.rcls == '2']), '3': col_samples(runs[runs.rcls == '3']),
 '4': col_samples(runs[runs.shotgun == 1]),
 '5': col_samples_pass(passes[passes.pcls == '5']),
 '6': col_samples_pass(passes[passes.pcls.isin(['6', '6s'])]),
 '7': col_samples_pass(passes[passes.pcls.isin(['7', '7s'])]),
 '8': col_samples_pass(passes[passes.pcls == '8']),
 '9': col_samples_pass(passes[passes.pcls.isin(['6s', '7s'])]),
}
LEAGUE_B = [('Y', r.yards_gained, r.out_of_bounds == 1) for r in runs[runs.yards_gained >= 15].itertuples()]
def qt_outcome(r):
    y = r.yards_gained if not pd.isna(r.yards_gained) else 0
    if r.fumble == 1 and r.fumble_out_of_bounds != 1: return ('F', y)
    return ('Y', y, r.out_of_bounds == 1)
LEAGUE_QT = [qt_outcome(r) for r in qt_plays.itertuples()]
SACK_MULT = {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0.35, '6': 0.75, '7': 1.15, '8': 1.5, '9': 0.9}
PI_MULT = {'1': 0, '2': 0, '3': 0, '4': 0, '5': 0.2, '6': 0.6, '7': 1.3, '8': 2.2, '9': 0.9}
lg_qt_rate = len(qt_plays) / max(1, len(drop) + (pl.qb_scramble == 1).sum() * 0)

def pens_for(frame, t):
    out = []
    for r in frame.itertuples():
        o = pen_outcome(r._asdict())
        if o and o[0] == t: out.append(o)
    return out
LG_PEN_SAMPLES = {t: pens_for(pens, t) for t in ('OFF', 'DEF', 'PI')}
lg_pen = {t: len(LG_PEN_SAMPLES[t]) / LEAGUE_SNAPS for t in LG_PEN_SAMPLES}

# ---------- kicking ----------
ko = df[(df.play_type == 'kickoff') & (df.own_kickoff_recovery != 1)]
pu = df[(df.play_type == 'punt')]
fg = df[(df.play_type == 'field_goal')]
xp = df[(df.play_type == 'extra_point')]
ints = df[(df.interception == 1)]

# FG make rate by kick distance (2025 league rates; long end tapered since only strong kickers try those)
FG_CURVE = [(18, .995), (25, .98), (30, .97), (35, .91), (40, .86), (45, .83), (50, .74), (55, .66), (58, .55), (61, .35), (64, .12), (67, .02), (69, 0)]
def fg_p(dist, shift=0):
    for (x0, y0), (x1, y1) in zip(FG_CURVE, FG_CURVE[1:]):
        if dist <= x1:
            p = y0 + (y1 - y0) * (max(dist, x0) - x0) / (x1 - x0); break
    else: p = 0
    if p <= 0 or p >= 1 or not shift: return p
    l = math.log(p / (1 - p)) + shift
    return 1 / (1 + math.exp(-l))

def ko_out(r):
    if r.touchback == 1: return ('TB',)
    if r.kickoff_out_of_bounds == 1: return ('OB',)
    return ('Y', r.kick_distance if not pd.isna(r.kick_distance) else 60, False)
def ret_out(r):
    if r.return_touchdown == 1: return ('TD',)
    if r.fumble_lost == 1: return ('F', r.return_yards if not pd.isna(r.return_yards) else 0)
    return ('Y', r.return_yards if not pd.isna(r.return_yards) else 0, False)
def punt_out(r):
    if r.punt_blocked == 1: return ('BLK',)
    if r.touchback == 1: return ('TB',)
    dist = r.kick_distance if not pd.isna(r.kick_distance) else 44
    if r.punt_out_of_bounds == 1 or r.punt_downed == 1: return ('PD', dist)
    if r.punt_fair_catch == 1: return ('PF', dist)
    return ('Y', dist, False)

LG_KO = [ko_out(r) for r in ko.itertuples()]
LG_KR = [ret_out(r) for r in ko[(ko.touchback != 1) & (ko.kickoff_out_of_bounds != 1)].itertuples()]
LG_P = [punt_out(r) for r in pu.itertuples()]
returned_p = pu[(pu.touchback != 1) & (pu.punt_out_of_bounds != 1) & (pu.punt_downed != 1) & (pu.punt_fair_catch != 1) & (pu.punt_blocked != 1)]
LG_PR = [ret_out(r) for r in returned_p.itertuples()]
LG_IR = [('TD',) if r.return_touchdown == 1 else ('Y', r.return_yards if not pd.isna(r.return_yards) else 0, False) for r in ints.itertuples()]

def build_punt(dist, key):
    """Punt column: distance with † (downed/out) or * (fair catch), TB, BLK."""
    conv = []
    for o, w in dist:
        if o[0] in ('PD', 'PF'): conv.append((('Y', o[1], o[0] == 'PD'), w, o[0]))
        else: conv.append((o, w, None))
    # build on yards, then mark rows
    base = build_column([(o, w) for o, w, _ in conv], key, oob_mark=False)
    # mark downed / fair-catch rows to match rates
    pd_m = sum(w for _, w, k in conv if k == 'PD'); pf_m = sum(w for _, w, k in conv if k == 'PF')
    yrows = [r for r, v in zip(ROWS, base) if v.lstrip('-').isdigit()]
    order = shuffled_rows(key + 'mark', yrows)
    acc = 0; out = dict(zip(ROWS, base))
    for r in order:
        if acc < pd_m: out[r] = out[r] + '†'
        elif acc < pd_m + pf_m: out[r] = out[r] + '*'
        else: break
        acc += PROB[r]
    return [out[r] for r in ROWS]

def build_fg(shift, key):
    rows = list(ROWS); col = {}
    blk = pick_rows(0.012, rows, key + 'blk')
    for r in blk: col[r] = 'BLK'
    rest = shuffled_rows(key, [r for r in rows if r not in blk])
    tot = sum(PROB[r] for r in rest); acc = 0
    for r in rest:
        u = (acc + PROB[r] / 2) / tot; acc += PROB[r]
        # value x: longest distance-to-goal this roll makes; P(V >= x) = fg_p(x+17)
        lo, hi = 0, 49
        while hi - lo > 1:
            m = (lo + hi) // 2
            if fg_p(m + 17, shift) >= u: lo = m
            else: hi = m
        col[r] = str(lo)
    return [col[r] for r in ROWS]

def rows_for_mass(mass, key):
    return sorted(pick_rows(mass, ROWS, key))

# ---------- defense ----------
KIND = {  # plays 1..9
 'A': 'gnnnnnnnn', 'B': 'ssgwwnwbn', 'C': 'wnsngnnns', 'D': 'nnnwssnwg', 'E': 'wwnbwnssn', 'F': 'ggnbbnggn',
}
KMEAN = {'s': -2.0, 'g': -1.5, 'n': -0.5, 'w': 1.0, 'b': 2.5}
PAT = [-2.28, -0.28, 0.72, 2.72, 5.72]

def def_chart(tm, deltas):
    out = {}
    for f, kinds in KIND.items():
        out[f] = {}
        for i, k in enumerate(kinds):
            p = str(i + 1); is_pass = i >= 4
            m = KMEAN[k] + (deltas['pass'] if is_pass else deltas['run'])
            s = 1.5 if is_pass else 1.0
            vals = []
            for j in range(5):
                v = int(round(m + s * PAT[j]))
                vals.append('' if v == 0 else str(v))
            if k == 's':
                if is_pass: vals[4] = 'INC'
                else: vals[0] = '(0)'
            if f == 'F' and p in ('6', '7', '8'): vals[3] = 'QT'
            if f == 'F' and p in ('1', '2', '3'): vals[4] = 'B'  # a blitz gamble can spring a run
            if is_pass and deltas['rush'] and vals[4] not in ('QT',) and f != 'F': vals[4] = 'QT'
            elif is_pass and deltas['cover'] and vals[4] == '' : vals[4] = 'INC'
            elif is_pass and deltas['cover'] and f in 'DE' and k in 'sg': vals[4] = 'INC'
            out[f][p] = vals
    return out

# ---------- per team ----------
games = df.drop_duplicates('game_id')[['home_team', 'away_team', 'home_score', 'away_score']]
def record(t):
    w = l = ti = 0
    for g in games.itertuples():
        if t not in (g.home_team, g.away_team): continue
        us, them = (g.home_score, g.away_score) if g.home_team == t else (g.away_score, g.home_score)
        if us > them: w += 1
        elif us < them: l += 1
        else: ti += 1
    return f"{w}-{l}" + (f"-{ti}" if ti else '')

lg_run_ypc = runs.yards_gained.mean()
comp = passes[passes.complete_pass == 1]
lg_comp_y = comp.yards_gained.mean(); lg_comp_pct = passes.complete_pass.mean()
lg_sack = (drop.sack == 1).mean()
lg_fum_rec = 1 - (df[(df.fumble == 1)].fumble_lost.mean())
lg_xp_miss = (xp.extra_point_result != 'good').mean()

teams = {}
for t in sorted(NAMES):
    key = f"{SEASON}{t}"
    off = {}
    tr = runs[runs.posteam == t]; tp = passes[passes.posteam == t]
    tdrop = drop[drop.posteam == t]; tqt = qt_plays[qt_plays.posteam == t]
    tsnaps = snaps[snaps.posteam == t]; tpens = pens[pens.posteam == t]
    qt_rate = 0.7 * (len(tqt) / max(1, len(tdrop))) + 0.3 * lg_qt_rate
    team_s = {
     '1': col_samples(tr[tr.rcls == '1']), '2': col_samples(tr[tr.rcls == '2']), '3': col_samples(tr[tr.rcls == '3']),
     '4': col_samples(tr[tr.shotgun == 1]),
     '5': col_samples_pass(tp[tp.pcls == '5']), '6': col_samples_pass(tp[tp.pcls.isin(['6', '6s'])]),
     '7': col_samples_pass(tp[tp.pcls.isin(['7', '7s'])]), '8': col_samples_pass(tp[tp.pcls == '8']),
     '9': col_samples_pass(tp[tp.pcls.isin(['6s', '7s'])]),
    }
    pen_rate = {u: 0.6 * (len(pens_for(tpens, u)) / max(1, len(tsnaps))) + 0.4 * lg_pen[u] for u in ('OFF', 'DEF', 'PI')}
    for c in '123456789':
        dist = mix(team_s[c], LEAGUE[c], 40)
        extras = []
        if SACK_MULT[c]:
            extras.append((('QT',), qt_rate * SACK_MULT[c]))
        for u in ('OFF', 'DEF'):
            extras += [(o, pen_rate[u] / len(LG_PEN_SAMPLES[u])) for o in LG_PEN_SAMPLES[u]]
        if PI_MULT[c]:
            extras += [(o, pen_rate['PI'] * PI_MULT[c] / len(LG_PEN_SAMPLES['PI'])) for o in LG_PEN_SAMPLES['PI']]
        em = sum(w for _, w in extras)
        dist = [(o, w * (1 - em)) for o, w in dist] + extras
        off[c] = build_column(dist, key + c)
    tB = [('Y', r.yards_gained, r.out_of_bounds == 1) for r in tr[tr.yards_gained >= 15].itertuples()]
    off['B'] = build_column(mix(tB, LEAGUE_B, 25), key + 'B')
    off['QT'] = build_column(mix([qt_outcome(r) for r in tqt.itertuples()], LEAGUE_QT, 30), key + 'QT')
    # nflverse: on kickoffs posteam is the receiving team, defteam the kicking team
    kk = ko[ko.defteam == t]; kr = ko[(ko.posteam == t) & (ko.touchback != 1) & (ko.kickoff_out_of_bounds != 1)]
    off['KO'] = build_column(mix([ko_out(r) for r in kk.itertuples()], LG_KO, 20), key + 'KO', oob_mark=False)
    off['KR'] = build_column(mix([ret_out(r) for r in kr.itertuples()], LG_KR, 20), key + 'KR', oob_mark=False)
    tp_ = pu[pu.posteam == t]
    off['P'] = build_punt(mix([punt_out(r) for r in tp_.itertuples()], LG_P, 20), key + 'P')
    pr = returned_p[returned_p.defteam == t]
    off['PR'] = build_column(mix([ret_out(r) for r in pr.itertuples()], LG_PR, 20), key + 'PR', oob_mark=False)
    ir = ints[ints.defteam == t]
    off['IR'] = build_column(mix([('TD',) if r.return_touchdown == 1 else ('Y', r.return_yards if not pd.isna(r.return_yards) else 0, False) for r in ir.itertuples()], LG_IR, 15), key + 'IR', oob_mark=False)
    tfg = fg[fg.posteam == t]
    if len(tfg):
        exp_m = sum(fg_p(x) for x in tfg.kick_distance); act = (tfg.field_goal_result == 'made').sum()
        shift = max(-1.2, min(1.2, (act - exp_m) / max(1, len(tfg)) * 6))
    else: shift = 0
    off['FG'] = build_fg(shift, key + 'FG')
    # defense
    dr = runs[runs.defteam == t]; dp = passes[passes.defteam == t]; dd = drop[drop.defteam == t]
    dcomp = dp[dp.complete_pass == 1]
    deltas = {
     'run': 0.8 * (dr.yards_gained.mean() - lg_run_ypc),
     'pass': 0.8 * (dcomp.yards_gained.mean() - lg_comp_y),
     'rush': (dd.sack == 1).mean() > lg_sack + 0.012,
     'cover': dp.complete_pass.mean() < lg_comp_pct - 0.025,
    }
    tf = df[(df.fumble == 1) & (df.posteam == t)]
    rec = 0.3 * (1 - tf.fumble_lost.mean() if len(tf) else lg_fum_rec) + 0.7 * lg_fum_rec
    txp = xp[xp.posteam == t]
    miss = 0.5 * ((txp.extra_point_result != 'good').mean() if len(txp) else lg_xp_miss) + 0.5 * lg_xp_miss
    city, nick, color = NAMES[t]
    teams[t] = {
     'id': t, 'city': city, 'name': nick, 'color': color, 'season': SEASON, 'record': record(t),
     'off': off, 'def': def_chart(t, deltas),
     'fumRec': rows_for_mass(rec, key + 'fum'), 'patMiss': rows_for_mass(miss, key + 'pat'),
     'src': 'generated',
    }

print(f"// Generated by tools/make_charts.py from nflverse {SEASON} regular-season play-by-play. Do not edit by hand.")
print("const PD_TEAMS = " + json.dumps(teams, ensure_ascii=False, separators=(',', ':')) + ";")
print("if (typeof module !== 'undefined') module.exports = PD_TEAMS;")
