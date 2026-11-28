"""Draws the box-lid cover art for the bookshelf home page (icons/cover-<game>.svg).
Original illustrations; the game title is laid over them in HTML on the lid.
    python3 scripts/make-covers.py
"""
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
W, H = 400, 320

def svg(body, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice"><defs>{defs}</defs>{body}</svg>'

def burst(cx, cy, n, r, color, op=0.12):
    s = ''
    for i in range(n):
        a0 = 2 * math.pi * i / n; a1 = a0 + math.pi / n
        s += f'<path d="M{cx},{cy} L{cx + r * math.cos(a0):.1f},{cy + r * math.sin(a0):.1f} L{cx + r * math.cos(a1):.1f},{cy + r * math.sin(a1):.1f}Z" fill="{color}" opacity="{op}"/>'
    return s

def card(x, y, w, h, rot, num, color, face='#fffdf6'):
    fs = h * 0.5
    return (f'<g transform="translate({x},{y}) rotate({rot})">'
            f'<rect x="{-w/2+3}" y="{-h/2+5}" width="{w}" height="{h}" rx="{w*0.1}" fill="#000" opacity=".3"/>'
            f'<rect x="{-w/2}" y="{-h/2}" width="{w}" height="{h}" rx="{w*0.1}" fill="{face}" stroke="#d8cfbf" stroke-width="1.5"/>'
            f'<rect x="{-w/2+6}" y="{-h/2+6}" width="{w-12}" height="{h-12}" rx="{w*0.07}" fill="none" stroke="{color}" stroke-width="2" opacity=".35"/>'
            f'<text x="0" y="{fs*0.36}" text-anchor="middle" font-family="Arial Black,Arial,Helvetica,sans-serif" font-weight="900" font-size="{fs}" fill="{color}">{num}</text>'
            f'<text x="{-w/2+10}" y="{-h/2+20}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="14" fill="{color}">{num}</text></g>')

PIPS = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)], 4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
        5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)], 6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)]}

def die(cx, cy, s, top, front, right, rot=0, face='#ffffff', pip='#1a1f2e', red1=True):
    """Isometric-ish die: top, front-left, front-right faces with pips."""
    h = s * 0.5
    # face polygons around (cx,cy) = top corner of the front edge
    T = [(cx, cy - h), (cx + s * 0.87, cy - h - s * 0.5 + h), (cx, cy - s), (cx - s * 0.87, cy - h - s * 0.5 + h)]
    T = [(cx, cy - s * 0.0), (cx + s * 0.87, cy - s * 0.5), (cx, cy - s), (cx - s * 0.87, cy - s * 0.5)]
    L = [(cx - s * 0.87, cy - s * 0.5), (cx, cy), (cx, cy + s), (cx - s * 0.87, cy + s * 0.5)]
    R = [(cx, cy), (cx + s * 0.87, cy - s * 0.5), (cx + s * 0.87, cy + s * 0.5), (cx, cy + s)]
    poly = lambda P, f: f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in P)}" fill="{f}" stroke="#00000022" stroke-width="1" stroke-linejoin="round"/>'
    def pips(n, origin, e1, e2, col):
        # draw pips in face-local coordinates and skew them onto the face with a matrix
        out = f'<g transform="matrix({e1[0]:.2f} {e1[1]:.2f} {e2[0]:.2f} {e2[1]:.2f} {origin[0]:.1f} {origin[1]:.1f})">'
        for a, b in PIPS[n]:
            c = '#d8432f' if (n == 1 and red1) else col
            out += f'<circle cx="{a * 0.27:.2f}" cy="{b * 0.27:.2f}" r="{0.15 if n == 1 else 0.095}" fill="{c}"/>'
        return out + '</g>'
    tc = (cx, cy - s * 0.5); lc = (cx - s * 0.435, cy + s * 0.25); rc = (cx + s * 0.435, cy + s * 0.25)
    g = f'<g transform="rotate({rot} {cx} {cy})">'
    g += f'<ellipse cx="{cx+6}" cy="{cy+s*1.02}" rx="{s*0.95}" ry="{s*0.22}" fill="#000" opacity=".28"/>'
    g += poly(T, face) + poly(L, '#e8e3d8' if face == '#ffffff' else face) + poly(R, '#d6d0c2' if face == '#ffffff' else face)
    g += pips(top, tc, (s * 0.87, -s * 0.5), (-s * 0.87, -s * 0.5), pip)
    g += pips(front, lc, (s * 0.87, s * 0.5), (0, s), pip)
    g += pips(right, rc, (s * 0.87, -s * 0.5), (0, s), pip)
    return g + '</g>'

covers = {}

# ---- Flip 7: a fan of number cards under a starburst
b = '<rect width="400" height="320" fill="url(#bg)"/>' + burst(200, 150, 22, 420, '#ffffff', .06)
for i, (n, c) in enumerate([(3, '#2f8fd8'), (11, '#2f9a5a'), (5, '#e08a1c'), (12, '#8e44c4'), (7, '#e8384f')]):
    ang = -36 + i * 18
    rad = math.radians(ang)
    b += card(200 + 150 * math.sin(rad), 215 - 150 * math.cos(rad) + 70, 84, 120, ang, n, c) if n != 7 else ''
b += card(200, 140, 104, 148, 0, 7, '#e8384f')
for x, y, r in [(70, 60, 5), (335, 52, 7), (300, 120, 4), (95, 135, 3), (350, 175, 3)]:
    b += f'<path d="M{x},{y-r*2} L{x+r*.5},{y-r*.5} L{x+r*2},{y} L{x+r*.5},{y+r*.5} L{x},{y+r*2} L{x-r*.5},{y+r*.5} L{x-r*2},{y} L{x-r*.5},{y-r*.5}Z" fill="#ffd36b"/>'
covers['flip7'] = svg(b, '<radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#5a46b8"/><stop offset="1" stop-color="#160f33"/></radialGradient>')

# ---- Tap 4: four 4s slammed onto a stack, with impact lines
b = '<rect width="400" height="320" fill="url(#bg)"/>'
b += '<ellipse cx="200" cy="250" rx="170" ry="40" fill="#000" opacity=".25"/>'
for i, rot in enumerate([-14, -5, 6, 15]):
    b += card(200 + (i - 1.5) * 26, 165 - abs(i - 1.5) * 4, 92, 130, rot, 4, ['#d84a2a', '#2f6fd1', '#2f9a5a', '#c48a12'][i])
for a in range(-70, 71, 28):
    r = math.radians(a - 90)
    b += f'<line x1="{200+120*math.cos(r):.0f}" y1="{165+120*math.sin(r):.0f}" x2="{200+160*math.cos(r):.0f}" y2="{165+160*math.sin(r):.0f}" stroke="#ffd36b" stroke-width="7" stroke-linecap="round"/>'
covers['tap4'] = svg(b, '<radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#c46a2c"/><stop offset="1" stop-color="#3f1c08"/></radialGradient>')

# ---- Yahtzee: three dice tumbling under a spotlight, roll arcs behind
b = '<rect width="400" height="320" fill="url(#bg)"/>'
b += '<ellipse cx="200" cy="120" rx="190" ry="130" fill="url(#spot)"/>'
for d in ['M40,250 Q120,60 230,90', 'M60,280 Q200,110 330,140']:
    b += f'<path d="{d}" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round" opacity=".35"/>'
b += die(110, 130, 52, 5, 3, 2, -8) + die(205, 95, 62, 5, 4, 6, 6) + die(300, 140, 50, 5, 2, 3, 12)
covers['yahtzee'] = svg(b, '<radialGradient id="bg" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#2c4a94"/><stop offset="1" stop-color="#0c1530"/></radialGradient>'
                        '<radialGradient id="spot"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>')

# ---- Farkle: six red-pip dice spilling across a wooden table, a stack of chips
b = '<rect width="400" height="320" fill="url(#bg)"/>'
for y in range(0, 320, 46):
    b += f'<rect y="{y}" width="400" height="44" fill="#000" opacity="{.05 if (y//46)%2 else .0}"/><line x1="0" y1="{y+44}" x2="400" y2="{y+44}" stroke="#2a1208" stroke-width="2" opacity=".5"/>'
for i, c in enumerate(['#d8432f', '#f5b83d', '#2f9a5a', '#d8432f', '#f5b83d']):
    b += f'<ellipse cx="330" cy="{205-i*12}" rx="38" ry="13" fill="{c}" stroke="#00000044"/><ellipse cx="330" cy="{205-i*12}" rx="24" ry="8" fill="none" stroke="#ffffff88" stroke-width="2" stroke-dasharray="5 5"/>'
for args in [(95, 90, 40, 1, 2, 3, -10), (170, 140, 46, 5, 4, 6, 8), (80, 190, 38, 1, 3, 2, 15), (245, 95, 36, 1, 6, 4, -4), (255, 185, 42, 5, 1, 3, -12), (165, 235, 34, 1, 2, 4, 20)]:
    cx, cy, s, t, f, r, rot = args
    b += die(cx, cy, s, t, f, r, rot, face='#ffffff', pip='#d8432f', red1=True)
covers['farkle'] = svg(b, '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a4424"/><stop offset="1" stop-color="#3b1d12"/></linearGradient>')

# ---- Mahj: a rack of ivory tiles (dots, bamboo, flowers) on green felt
b = '<rect width="400" height="320" fill="url(#bg)"/>'
def tile(x, y, kind, rot=0):
    g = f'<g transform="translate({x},{y}) rotate({rot})"><rect x="-24" y="-30" width="52" height="68" rx="7" fill="#1d6b3d"/><rect x="-26" y="-34" width="52" height="68" rx="7" fill="#fbf6e6" stroke="#d6caa8"/>'
    if kind[0] == 'dot':
        n = kind[1]; pts = {1: [(0, 0)], 2: [(0, -12), (0, 12)], 3: [(-10, -14), (0, 0), (10, 14)], 4: [(-9, -11), (9, -11), (-9, 11), (9, 11)], 5: [(-10, -13), (10, -13), (0, 0), (-10, 13), (10, 13)]}[n]
        for px, py in pts:
            g += f'<circle cx="{px}" cy="{py}" r="{9 if n == 1 else 6}" fill="none" stroke="{"#c62d1f" if (px, py) == (0, 0) else "#2a5fb8"}" stroke-width="3"/><circle cx="{px}" cy="{py}" r="2" fill="#2a5fb8"/>'
    elif kind[0] == 'bam':
        for px in [-10, 0, 10][:kind[1]]:
            g += f'<rect x="{px-3}" y="-20" width="6" height="40" rx="3" fill="#2f9a5a"/><line x1="{px-3}" y1="0" x2="{px+3}" y2="0" stroke="#fbf6e6" stroke-width="2"/>'
    elif kind[0] == 'flower':
        for a in range(0, 360, 60):
            r = math.radians(a); g += f'<ellipse cx="{8*math.cos(r):.1f}" cy="{8*math.sin(r):.1f}" rx="7" ry="5" transform="rotate({a} {8*math.cos(r):.1f} {8*math.sin(r):.1f})" fill="#e8607a"/>'
        g += '<circle r="5" fill="#f5b83d"/>'
    elif kind[0] == 'joker':
        g += '<text y="9" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="20" fill="#7a3fc6">JKR</text>'
    return g + '</g>'
b += '<rect x="30" y="196" width="340" height="26" rx="6" fill="#0a2a17" opacity=".55"/>'
for i, k in enumerate([('dot', 1), ('dot', 3), ('bam', 2), ('flower',), ('bam', 3), ('dot', 5)]):
    b += tile(64 + i * 55, 160, k)
b += tile(130, 70, ('joker',), -14) + tile(270, 72, ('dot', 4), 12)
covers['mahj'] = svg(b, '<radialGradient id="bg" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#2f9a5a"/><stop offset="1" stop-color="#0a3420"/></radialGradient>')

# ---- Doomlings: a small planet with blob creatures, a meteor streaking in
b = '<rect width="400" height="320" fill="url(#bg)"/>'
for x, y, r in [(30, 40, 1.6), (80, 110, 1), (140, 30, 1.2), (330, 60, 1.8), (370, 140, 1), (60, 250, 1.3), (300, 280, 1), (220, 20, 1)]:
    b += f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff"/>'
b += '<path d="M390,10 L250,95" stroke="url(#trail)" stroke-width="14" stroke-linecap="round"/><circle cx="250" cy="95" r="14" fill="#ff8a3c"/><circle cx="250" cy="95" r="8" fill="#ffd36b"/>'
b += '<circle cx="190" cy="260" r="150" fill="url(#planet)"/><path d="M60,210 Q120,190 160,215 T260,205 T330,220" fill="none" stroke="#2c7a3a" stroke-width="10" opacity=".55"/>'
def blob(x, y, c, s=1):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M-22,0 Q-24,-34 0,-36 Q24,-34 22,0 Z" fill="{c}"/>'
            f'<circle cx="-8" cy="-20" r="6" fill="#fff"/><circle cx="8" cy="-20" r="6" fill="#fff"/><circle cx="-7" cy="-19" r="3" fill="#111"/><circle cx="9" cy="-19" r="3" fill="#111"/>'
            f'<path d="M-6,-8 Q0,-3 6,-8" stroke="#111" stroke-width="2" fill="none"/></g>')
b += blob(150, 118, '#9be15d') + blob(205, 112, '#ff7ab6', 1.15) + blob(258, 122, '#6bc6ff', .9)
covers['doomlings'] = svg(b, '<radialGradient id="bg" cx="40%" cy="30%" r="90%"><stop offset="0" stop-color="#3d3170"/><stop offset="1" stop-color="#0d0b18"/></radialGradient>'
    '<radialGradient id="planet" cx="40%" cy="25%" r="70%"><stop offset="0" stop-color="#5cc47a"/><stop offset="1" stop-color="#1e5a3a"/></radialGradient>'
    '<linearGradient id="trail" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a3c" stop-opacity="0"/><stop offset="1" stop-color="#ffd36b"/></linearGradient>')

# ---- Paydirt: a retro sunburst over a field in perspective, football up front
b = '<rect width="400" height="320" fill="#e9dcb5"/>' + burst(200, 110, 18, 420, '#c8372d', .22)
b += '<path d="M0,190 L400,190 L400,320 L0,320 Z" fill="#2f6b34"/>'
for i in range(-6, 7):
    b += f'<line x1="{200+i*40}" y1="190" x2="{200+i*150}" y2="320" stroke="#f4f1e6" stroke-width="2" opacity=".55"/>'
for y in [205, 228, 258, 296]:
    b += f'<line x1="0" y1="{y}" x2="400" y2="{y}" stroke="#f4f1e6" stroke-width="3" opacity=".7"/>'
b += '<g transform="translate(200,200) rotate(-20)"><ellipse rx="92" ry="54" fill="#000" opacity=".25" transform="translate(8,10)"/><ellipse rx="92" ry="54" fill="#7a3d17"/>'
b += '<path d="M-92,0 Q0,-80 92,0" fill="none" stroke="#5d2c0f" stroke-width="3"/><line x1="-40" y1="0" x2="40" y2="0" stroke="#fff" stroke-width="6"/>'
for x in range(-30, 31, 12): b += f'<line x1="{x}" y1="-9" x2="{x}" y2="9" stroke="#fff" stroke-width="4"/>'
b += '<path d="M-74,-26 Q-80,0 -74,26" stroke="#fff" stroke-width="5" fill="none"/><path d="M74,-26 Q80,0 74,26" stroke="#fff" stroke-width="5" fill="none"/></g>'
b += '<rect x="0" y="0" width="400" height="16" fill="#e0a526"/><rect x="0" y="22" width="400" height="6" fill="#c8372d"/>'
covers['paydirt'] = svg(b)

# ---- Tally: a legal pad with tally marks and a pencil
b = '<rect width="400" height="320" fill="#6b4a2c"/>'
b += '<g transform="rotate(-4 200 160)"><rect x="70" y="30" width="260" height="280" rx="4" fill="#fff6a8"/><rect x="70" y="30" width="260" height="34" rx="4" fill="#8b5a2b"/>'
for y in range(84, 300, 22): b += f'<line x1="70" y1="{y}" x2="330" y2="{y}" stroke="#9cc3e8" stroke-width="2"/>'
b += '<line x1="104" y1="64" x2="104" y2="310" stroke="#e88" stroke-width="2"/>'
for row, (name, n) in enumerate([('AJ', 7), ('Mom', 5), ('Sam', 9)]):
    y = 100 + row * 66
    b += f'<text x="112" y="{y+8}" font-family="Comic Sans MS,Chalkboard,Marker Felt,cursive" font-size="22" fill="#2b3a8a">{name}</text>'
    for k in range(n):
        g, j = divmod(k, 5)
        x = 175 + g * 70 + j * 10
        if j < 4: b += f'<line x1="{x}" y1="{y-10}" x2="{x+2}" y2="{y+18}" stroke="#2b3a8a" stroke-width="4" stroke-linecap="round"/>'
        else: b += f'<line x1="{x-44}" y1="{y+12}" x2="{x+2}" y2="{y-6}" stroke="#2b3a8a" stroke-width="4" stroke-linecap="round"/>'
b += '</g><g transform="translate(300,250) rotate(-35)"><rect x="-90" y="-9" width="170" height="18" fill="#f5b83d"/><rect x="80" y="-9" width="18" height="18" fill="#e8a0a0"/><rect x="74" y="-9" width="8" height="18" fill="#c0c0c0"/><path d="M-90,-9 L-112,0 L-90,9 Z" fill="#e9c896"/><path d="M-104,-3 L-112,0 L-104,3 Z" fill="#333"/></g>'
covers['tally'] = svg(b)

# ---- Uno: a red card slapped down over a fan, color wheel behind
b = '<rect width="400" height="320" fill="url(#bg)"/>' + burst(200, 150, 24, 420, '#ffffff', .07)
def ucard(x, y, rot, fill, num):
    return (f'<g transform="translate({x},{y}) rotate({rot})"><rect x="-47" y="-67" width="100" height="140" rx="12" fill="#000" opacity=".3"/>'
            f'<rect x="-50" y="-70" width="100" height="140" rx="12" fill="#fff"/><rect x="-43" y="-63" width="86" height="126" rx="9" fill="{fill}"/>'
            f'<circle r="34" fill="#fff"/><text y="17" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="46" fill="{fill}">{num}</text></g>')
b += ucard(120, 170, -24, '#2e6fd8', '4') + ucard(280, 170, 22, '#2fa35a', '+2') + ucard(160, 150, -8, '#f5c021', '9') + ucard(225, 145, 6, '#e23b2e', '7')
covers['uno'] = svg(b, '<radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#d8342a"/><stop offset="1" stop-color="#5c0b0b"/></radialGradient>')

# ---- Phase 10: a staircase of numbered cards climbing to 10
b = '<rect width="400" height="320" fill="url(#bg)"/>'
for i in range(10):
    x, y = 30 + i * 36, 230 - i * 16
    col = ['#e23b2e', '#2e6fd8', '#2fa35a', '#e9a810'][i % 4]
    b += (f'<g transform="translate({x},{y})"><rect x="3" y="4" width="46" height="66" rx="7" fill="#000" opacity=".3"/><rect width="46" height="66" rx="7" fill="#fff"/>'
          f'<rect x="4" y="4" width="38" height="58" rx="5" fill="{col}"/><text x="23" y="44" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="{26 if i < 9 else 22}" fill="#fff">{i + 1}</text></g>')
covers['phase10'] = svg(b, '<radialGradient id="bg" cx="50%" cy="30%" r="85%"><stop offset="0" stop-color="#2a4bb0"/><stop offset="1" stop-color="#0f1f4d"/></radialGradient>')

# ---- Skip-Bo: four build piles counting up, a wild on top
b = '<rect width="400" height="320" fill="url(#bg)"/>'
def scard(x, y, rot, v):
    if v == 'SB':
        inner = '<rect x="4" y="4" width="62" height="88" rx="7" fill="#f28c28"/><text x="35" y="58" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-style="italic" font-size="28" fill="#fff">SB</text>'
    else:
        col = '#2e6fd8' if v <= 4 else '#2fa35a' if v <= 8 else '#e23b2e'
        inner = f'<text x="35" y="64" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="44" fill="{col}">{v}</text><text x="9" y="20" font-family="Arial,sans-serif" font-weight="700" font-size="13" fill="{col}">{v}</text>'
    return f'<g transform="translate({x},{y}) rotate({rot} 35 48)"><rect x="3" y="5" width="70" height="96" rx="9" fill="#000" opacity=".3"/><rect width="70" height="96" rx="9" fill="#fff"/>{inner}</g>'
for col, vals in enumerate([[1, 2, 3], [5, 6, 7, 8], [9, 10, 'SB', 12], [2, 3, 4]]):
    for k, v in enumerate(vals):
        b += scard(30 + col * 88, 90 + k * 26, (k - 1) * 3, v)
covers['skipbo'] = svg(b, '<radialGradient id="bg" cx="50%" cy="30%" r="85%"><stop offset="0" stop-color="#16808a"/><stop offset="1" stop-color="#08363c"/></radialGradient>')

# ---- Monopoly: a row of colored lots in perspective, little houses and a hotel, two dice up front
b = '<rect width="400" height="320" fill="url(#bg)"/>' + burst(200, 90, 20, 420, '#ffffff', .06)
lots = ['#8a4b2a', '#9fd7f5', '#d6409f', '#f39324', '#e2272c', '#f2d82b', '#1f9e4a', '#1f4fa8']
for k, c in enumerate(lots):
    x = 6 + k * 49
    b += f'<rect x="{x}" y="168" width="46" height="74" rx="3" fill="#f6f3e7"/><rect x="{x}" y="168" width="46" height="18" rx="3" fill="{c}"/>'
def house(x, y, s, wall, roof):
    return (f'<g transform="translate({x},{y}) scale({s})"><rect x="-13" y="-4" width="26" height="22" fill="#000" opacity=".25" transform="translate(3,3)"/>'
            f'<rect x="-13" y="-4" width="26" height="22" fill="{wall}"/><path d="M-17,-2 L0,-18 L17,-2 Z" fill="{roof}"/><rect x="-4" y="6" width="8" height="12" fill="#00000055"/></g>')
for k, x in enumerate([60, 108, 157, 206]): b += house(x, 150, 1.05, '#2fae5b', '#1b7a3b')
b += ('<g transform="translate(300,128)"><rect x="-36" y="-20" width="72" height="44" fill="#000" opacity=".25" transform="translate(4,4)"/>'
      '<rect x="-36" y="-20" width="72" height="44" fill="#e2463b"/><path d="M-42,-18 L0,-46 L42,-18 Z" fill="#9c1f18"/>'
      + ''.join(f'<rect x="{-28 + j * 15}" y="-10" width="9" height="10" fill="#ffe9a6"/>' for j in range(4)) + '</g>')
b += die(150, 262, 34, 6, 3, 5) + die(250, 268, 34, 5, 2, 4)
covers['monopoly'] = svg(b, '<radialGradient id="bg" cx="50%" cy="25%" r="85%"><stop offset="0" stop-color="#2f8a5e"/><stop offset="1" stop-color="#0c2a1d"/></radialGradient>')

for k, v in covers.items():
    with open(os.path.join(OUT, f'cover-{k}.svg'), 'w') as f: f.write(v)
print('wrote', ', '.join(covers))
