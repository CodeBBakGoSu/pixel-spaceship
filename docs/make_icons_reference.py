#!/usr/bin/env python3
"""ASTER WING concept icon sheet: 20 procedurally drawn 24x24 pixel icons (CONCEPT, not final art)."""
from PIL import Image, ImageDraw, ImageFont
import math

S = 24
OUT = (11, 16, 32, 255)
def C(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16), a)
P = dict(
    steelL=C('dfe8f7'), steel=C('9fb2d0'), steelD=C('5a6c92'), steelDD=C('36456b'),
    cyanL=C('b8f6ff'), cyan=C('3de0ff'), cyanD=C('1b8fb5'),
    orgL=C('ffd08a'), org=C('ff9a2e'), orgD=C('c25a12'),
    yel=C('ffe14d'), yelD=C('d9a521'), red=C('ff4a5a'), redD=C('a82a3a'),
    grn=C('5be37d'), grnD=C('2b9a4f'), vio=C('a77bff'), vioD=C('5f3fb3'),
    wht=C('ffffff'), gold=C('ffcc33'), goldD=C('b3801a'), blk=C('1b2038'),
)

class Cv:
    def __init__(s): s.im = Image.new('RGBA', (S, S), (0,0,0,0)); s.p = s.im.load()
    def px(s, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < S and 0 <= y < S: s.p[x, y] = c
    def rect(s, x0, y0, x1, y1, c):
        for y in range(y0, y1+1):
            for x in range(x0, x1+1): s.px(x, y, c)
    def line(s, x0, y0, x1, y1, c, w=1):
        n = int(max(abs(x1-x0), abs(y1-y0))) * 2 + 1
        for i in range(n+1):
            t = i / n; x = x0 + (x1-x0)*t; y = y0 + (y1-y0)*t
            for dx in range(w):
                for dy in range(w): s.px(math.floor(x)+dx, math.floor(y)+dy, c)
    def disc(s, cx, cy, r, c):
        for y in range(S):
            for x in range(S):
                if (x-cx)**2 + (y-cy)**2 <= r*r + 0.2: s.px(x, y, c)
    def ring(s, cx, cy, r, c, t=0.9):
        for y in range(S):
            for x in range(S):
                d = math.hypot(x-cx, y-cy)
                if r - t <= d <= r + t*0.6: s.px(x, y, c)
    def poly(s, pts, c):
        im = Image.new('L', (S, S), 0); ImageDraw.Draw(im).polygon(pts, fill=255)
        q = im.load()
        for y in range(S):
            for x in range(S):
                if q[x, y]: s.p[x, y] = c

# ---------------- weapons ----------------
def twin_cannon(g):
    for bx in (6, 14):
        g.rect(bx, 8, bx+3, 19, P['steel']); g.rect(bx, 8, bx, 19, P['steelL'])
        g.rect(bx+3, 8, bx+3, 19, P['steelD']); g.rect(bx-1, 5, bx+4, 8, P['steelD'])
        g.rect(bx, 4, bx+3, 5, P['orgL']); g.px(bx+1, 3, P['yel'])
    g.rect(4, 17, 19, 21, P['steelD']); g.rect(4, 17, 19, 17, P['steel']); g.rect(10, 18, 13, 20, P['org'])
    for x, y in ((9, 1), (12, 2), (10, 0)): g.px(x, y, P['yel'])
def wing_pods(g):
    g.poly([(11,3),(12,3),(14,17),(12,20),(11,20),(9,17)], P['steel']); g.rect(11,5,12,16,P['steelL'])
    g.poly([(2,11),(9,9),(9,15),(3,14)], P['steelD']); g.poly([(14,9),(21,11),(20,14),(14,15)], P['steelD'])
    g.rect(10, 18, 13, 19, P['steelD'])
    for px_ in (1, 20):
        g.rect(px_, 12, px_+2, 17, P['org']); g.rect(px_, 12, px_+2, 12, P['orgL'])
    g.line(0,8,0,4,P['yel']); g.line(23,8,23,4,P['yel']); g.line(3,9,3,6,P['yel']); g.line(20,9,20,6,P['yel'])
def seeker(g):
    for i, (x, y) in enumerate([(4,20),(5,18),(7,16),(8,15),(10,14),(12,12)]):
        g.disc(x, y, 1.2 if i % 2 == 0 else 0.7, P['steelL'] if i < 3 else P['steel'])
    g.poly([(11,13),(16,8),(18,10),(13,15)], P['steel']); g.poly([(15,7),(19,3),(20,4),(21,8),(17,10)], P['red'])
    g.line(12,13,17,8,P['steelL']); g.poly([(9,12),(12,12),(11,15)], P['steelD']); g.poly([(14,17),(14,14),(12,15)], P['steelD'])
    g.px(10,15,P['orgL']); g.px(9,16,P['org']); g.px(20,2,P['yel'])
def rail(g):
    g.rect(10, 0, 13, 20, P['cyanD']); g.rect(11, 0, 12, 20, P['cyan']); g.rect(11, 2, 12, 18, P['wht'])
    g.rect(5, 12, 7, 21, P['steelD']); g.rect(16, 12, 18, 21, P['steelD'])
    g.rect(5, 12, 5, 21, P['steel']); g.rect(16, 12, 16, 21, P['steel'])
    g.rect(8, 19, 15, 22, P['steelD']); g.rect(9, 19, 14, 19, P['steel'])
    for y in (4, 8, 12): g.px(9, y, P['cyanL']); g.px(14, y, P['cyanL'])
    g.px(11,0,P['wht']); g.px(12,0,P['wht']); g.px(8,1,P['cyanL']); g.px(15,1,P['cyanL'])
def flak(g):
    cx, cy = 12, 10
    for a in range(0, 360, 30):
        r = 10 if (a//30) % 2 == 0 else 7
        g.line(cx, cy, cx + math.cos(math.radians(a))*r, cy + math.sin(math.radians(a))*r, P['org'], 2 if r == 10 else 1)
    g.disc(cx, cy, 5.4, P['org']); g.disc(cx, cy, 4, P['yel']); g.disc(cx-0.5, cy-0.5, 2, P['wht'])
    g.rect(10, 19, 13, 22, P['steelD']); g.rect(11, 19, 12, 22, P['steel']); g.px(11,18,P['orgL'])
def ion_wake(g):
    g.poly([(11,1),(13,1),(15,8),(12,10),(9,8)], P['steelL']); g.rect(11,3,12,7,P['cyan'])
    for k, col in enumerate((P['cyanL'], P['cyan'], P['cyanD'])):
        for y in range(10, 23):
            x = 12 + math.sin((y - 10) * 0.9) * (1.5 + (y - 10) * 0.3) * (1 if k != 1 else -1)
            g.px(x - 1 + k*0.0, y, col) if k != 1 else g.px(x, y, col)
    for y in range(12, 23, 3): g.px(12, y, P['wht'])
def drones(g):
    g.ring(12, 12, 9, P['cyanD'], 0.7)
    for ang in range(0, 360, 14):
        pass
    g.disc(12, 12, 3.2, P['steelD']); g.disc(12, 12, 2, P['cyan']); g.px(11, 11, P['wht'])
    for ang in (-40, 140):
        x = 12 + math.cos(math.radians(ang))*9; y = 12 + math.sin(math.radians(ang))*9
        g.rect(int(x)-2, int(y)-2, int(x)+2, int(y)+2, P['steel']); g.rect(int(x)-2, int(y)-2, int(x)+2, int(y)-2, P['steelL'])
        g.px(int(x), int(y), P['org']); g.rect(int(x)-3, int(y), int(x)-3, int(y), P['steelD']); g.rect(int(x)+3, int(y), int(x)+3, int(y), P['steelD'])
def phoenix(g):
    g.poly([(12,1),(17,8),(19,14),(16,20),(12,22),(8,20),(5,14),(7,8)], P['red'])
    g.poly([(12,4),(16,10),(17,15),(14,20),(12,21),(10,20),(7,15),(9,10)], P['org'])
    g.poly([(12,9),(14,13),(14,17),(12,19),(10,17),(10,13)], P['yel']); g.poly([(12,13),(13,16),(12,18),(11,16)], P['wht'])
    g.px(3, 6, P['yel']); g.px(20, 5, P['yel']); g.px(2, 12, P['org']); g.px(21, 11, P['org'])
    g.line(4,3,5,4,P['orgL']); g.px(19,18,P['yel'])
def bomb_bay(g):
    g.disc(12, 14, 7, P['steelDD']); g.disc(12, 14, 6, P['steelD']); g.disc(10, 12, 3, P['steel']); g.px(9,10,P['steelL']); g.px(10,10,P['steelL'])
    g.poly([(8,7),(16,7),(18,2),(15,3),(12,5),(9,3),(6,2)], P['red']); g.rect(8,6,16,7,P['redD'])
    g.line(12,21,12,23,P['org']); g.px(12,22,P['yel'])
    for x in (4, 20): g.line(x,16,x,20,P['steel'])
def arc(g):
    g.poly([(14,0),(5,12),(11,12),(8,23),(19,9),(13,9),(17,0)], P['yelD'])
    g.poly([(14,1),(7,11),(12,11),(10,20),(17,10),(12,10),(15,1)], P['yel'])
    g.poly([(14,2),(9,10),(12,10),(11,15),(14,10),(11,10)], P['wht'])
    for x, y in ((3,4),(20,6),(4,18),(20,17)): g.disc(x, y, 1.2, P['cyan']); g.px(x, y, P['cyanL'])
    g.line(3,4,6,8,P['cyan']); g.line(20,6,16,8,P['cyan']); g.line(4,18,8,17,P['cyan']); g.line(20,17,16,16,P['cyan'])

# ---------------- buffs ----------------
def overdrive(g):
    for i, y in enumerate(range(4, 20, 3)):
        g.rect(5, y, 18, y+1, P['org']); g.rect(5, y, 18, y, P['orgL']); g.rect(5, y+1, 18, y+1, P['orgD'])
        g.px(5, y, P['orgD']); g.px(18, y+1, P['orgD'])
    g.rect(3, 3, 4, 20, P['steelD']); g.rect(19, 3, 20, 20, P['steelD'])
    g.poly([(14,0),(9,9),(13,9),(10,18),(17,7),(12,7),(15,0)], P['yel'])
def hull(g):
    g.poly([(3,3),(20,3),(20,13),(12,22),(3,13)], P['steelDD']); g.poly([(4,4),(19,4),(19,12),(12,20),(4,12)], P['steel'])
    g.poly([(4,4),(11,4),(11,19),(4,12)], P['steelL']); g.poly([(12,4),(19,4),(19,12),(12,19)], P['steelD'])
    g.rect(10,7,13,15,P['red']); g.rect(8,10,15,12,P['red']); g.rect(11,8,12,14,P['orgL']); g.rect(9,11,14,11,P['orgL'])
    for x, y in ((5,5),(18,5)): g.px(x, y, P['wht'])
def magnet(g):
    g.ring(12, 11, 7, P['red'], 1.8); g.rect(0, 12, 24, 23, (0,0,0,0)) if False else None
    for y in range(S):
        for x in range(S):
            if y > 13 and 6 < x < 17: g.px(x, y, (0,0,0,0))
    g.rect(3, 11, 7, 18, P['red']); g.rect(16, 11, 20, 18, P['red']); g.rect(3,11,4,18,P['redD']) if False else None
    g.rect(3, 17, 7, 20, P['steelL']); g.rect(16, 17, 20, 20, P['steelL']); g.rect(3,19,7,20,P['steel']); g.rect(16,19,20,20,P['steel'])
    g.px(11,2,P['wht']); g.px(12,2,P['wht'])
    for x, y in ((1,22),(22,22),(11,23),(0,14),(23,14)): g.px(x, y, P['grn'])
def band_lens(g):
    for y, c in ((4, P['steelD']), (11, P['cyan']), (18, P['steelD'])):
        g.rect(2, y, 21, y+1, c)
    g.rect(2, 11, 21, 11, P['cyanL'])
    g.rect(2, 9, 3, 14, P['yel']); g.rect(20, 9, 21, 14, P['yel']); g.rect(2, 9, 5, 9, P['yel']); g.rect(2, 14, 5, 14, P['yel'])
    g.rect(18, 9, 21, 9, P['yel']); g.rect(18, 14, 21, 14, P['yel'])
    g.poly([(11,0),(14,3),(9,3)], P['org']) if False else None
    g.poly([(12,6),(15,9),(9,9)], P['grn']); g.poly([(12,17),(15,14),(9,14)], P['grn'])
def thrusters(g):
    g.rect(8, 12, 15, 16, P['steel']); g.rect(8,12,15,12,P['steelL']); g.rect(6, 16, 17, 18, P['steelD']); g.rect(8,12,9,17,P['steelL'])
    g.poly([(8,19),(15,19),(12,23)], P['org']); g.poly([(10,19),(13,19),(12,22)], P['yel'])
    for y in (9, 4):
        g.poly([(12,y-3),(18,y+3),(15,y+3),(12,y),(9,y+3),(6,y+3)], P['cyan']); g.px(12, y-2, P['cyanL'])
def flare_bay(g):
    g.rect(2, 12, 21, 21, P['steelDD']); g.rect(3, 13, 20, 20, P['steelD']); g.rect(2,12,21,12,P['steel'])
    g.rect(4, 14, 19, 19, P['blk'])
    for x in (7, 12, 17):
        g.disc(x, 15, 2.2, P['org']); g.disc(x, 15, 1.2, P['yel'])
        g.line(x, 11, x, 7, P['org']) if x == 12 else None
    g.poly([(12,1),(15,6),(12,8),(9,6)], P['red']); g.poly([(12,3),(14,6),(12,7),(10,6)], P['yel'])
def ordnance_rack(g):
    g.rect(2, 3, 21, 5, P['steel']); g.rect(2,3,21,3,P['steelL']); g.rect(2,5,21,5,P['steelD'])
    for x in (6, 17):
        g.line(x, 6, x, 7, P['steelD'])
        g.disc(x, 12, 3.6, P['steelD']); g.rect(x-3, 8, x+3, 16, P['steelD']); g.disc(x, 16, 3.2, P['steelD'])
        g.rect(x-2, 9, x-1, 15, P['steel']); g.rect(x-1,8,x+1,8,P['steel'])
        g.poly([(x-3,19),(x+3,19),(x+1,22),(x-1,22)], P['red']); g.rect(x-1,16,x+1,18,P['org'])
def fire_control(g):
    g.ring(12, 12, 8, P['grn'], 0.8); g.ring(12, 12, 4, P['grnD'], 0.6)
    for a in (0, 90, 180, 270):
        dx, dy = math.cos(math.radians(a)), math.sin(math.radians(a))
        g.line(12+dx*5, 12+dy*5, 12+dx*11, 12+dy*11, P['grn'], 1)
    g.px(12,12,P['red']); g.rect(11,11,12,12,P['red'])
    for x, y in ((3,3),(20,3),(3,20),(20,20)): g.px(x, y, P['yel'])
def capacitor(g):
    g.rect(6, 5, 17, 20, P['steelD']); g.rect(6, 5, 17, 5, P['steel']); g.rect(6,5,7,20,P['steel'])
    g.rect(6, 5, 17, 7, P['org']); g.rect(6, 5, 17, 5, P['orgL']); g.rect(8, 3, 9, 4, P['steelL']); g.rect(14, 3, 15, 4, P['steelL'])
    g.rect(16, 7, 17, 20, P['steelDD'])
    g.poly([(13,8),(9,14),(12,14),(10,19),(15,12),(12,12)], P['yel']); g.px(12,13,P['wht'])
    g.rect(4, 22, 19, 23, P['steelD'])
def beacon(g):
    g.rect(11, 12, 12, 21, P['steel']); g.rect(8, 21, 15, 22, P['steelD']); g.rect(11,12,11,21,P['steelL'])
    g.poly([(12,2),(17,7),(12,12),(7,7)], P['grn']); g.poly([(12,2),(12,12),(7,7)], P['grnD']) if False else None
    g.poly([(12,3),(15,7),(12,10),(9,7)], P['wht']) if False else None
    g.poly([(12,2),(17,7),(12,7)], P['grn']); g.poly([(12,2),(7,7),(12,7)], P['grnD']); g.poly([(7,7),(17,7),(12,12)], P['grnD'])
    g.poly([(12,2),(9,5),(12,5)], P['wht'])
    for r in (7, 10):
        for a in (-35, 35):
            for t in range(-18, 19, 6):
                pass
    for r, c in ((6, P['cyan']), (9, P['cyanD'])):
        for a in range(-50, 51, 5):
            g.px(12 + math.sin(math.radians(a)) * r + (0), 7 - math.cos(math.radians(a)) * r * 0.6 - 0, c) if False else None
    g.px(4,5,P['cyan']); g.px(3,8,P['cyan']); g.px(20,5,P['cyan']); g.px(21,8,P['cyan']); g.px(2,11,P['cyanD']); g.px(22,11,P['cyanD'])

def aurora_gatling(g):
    for i, bx in enumerate((3, 8, 13, 18)):
        g.rect(bx, 9, bx+2, 19, P['steel']); g.rect(bx, 9, bx, 19, P['steelL']); g.rect(bx+2, 9, bx+2, 19, P['steelD'])
        g.rect(bx, 6, bx+2, 8, P['cyan'] if i % 2 else P['org']); g.px(bx+1, 4, P['wht']); g.px(bx+1, 2, P['yel'] if i % 2 == 0 else P['cyanL'])
    g.rect(1, 18, 22, 22, P['steelD']); g.rect(1, 18, 22, 18, P['steel']); g.rect(9, 19, 14, 21, P['gold'])
    for x, y in ((0,3),(22,2),(11,0)): g.px(x, y, P['wht'])

WEAPONS = [
    ('Twin Cannon', '쌍발 기관포', twin_cannon), ('Wing Pods', '윙 포드', wing_pods),
    ('Seeker Missiles', '추적 미사일', seeker), ('Rail Lance', '레일 랜스', rail),
    ('Flak Burst', '대공 파열포', flak), ('Ion Wake', '이온 항적', ion_wake),
    ('Orbit Drones', '궤도 드론', drones), ('Phoenix Flares', '피닉스 플레어', phoenix),
    ('Bomb Bay', '폭탄창', bomb_bay), ('Arc Lightning', '아크 번개', arc),
]
BUFFS = [
    ('Overdrive Coil', '과부하 코일', overdrive), ('Hull Plating', '장갑판', hull),
    ('Magnet Core', '자석 코어', magnet), ('Band Lens', '대역 렌즈', band_lens),
    ('Vector Thrusters', '벡터 스러스터', thrusters), ('Flare Bay', '플레어 베이', flare_bay),
    ('Ordnance Rack', '폭장 랙', ordnance_rack), ('Fire Control', '사격통제', fire_control),
    ('Capacitor', '축전기', capacitor), ('Salvage Beacon', '인양 비콘', beacon),
]

FR = dict(common=('8aa0c0', '3a4a6a'), uncommon=('5be37d', '1f6a3a'), rare=('a77bff', '40298a'), evolved=('ffcc33', '8a5c0a'))
def outline(g):
    out = Image.new('RGBA', (S, S), (0,0,0,0)); o = out.load(); p = g.im.load()
    for y in range(S):
        for x in range(S):
            if p[x, y][3]: o[x, y] = p[x, y]
    for y in range(S):
        for x in range(S):
            if p[x, y][3] == 0:
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < S and 0 <= ny < S and p[nx, ny][3]: o[x, y] = OUT; break
    return out

def tile(fn, kind, rarity='common'):
    g = Cv(); fn(g); icon = outline(g)
    T = S + 4
    t = Image.new('RGBA', (T, T), (0,0,0,0)); d = ImageDraw.Draw(t); tp = t.load()
    hi, lo = FR[rarity]
    bg_a, bg_b = (C('241830'), C('150e22')) if kind == 'w' else (C('12263a'), C('0b1624'))
    d.rectangle([0,0,T-1,T-1], fill=C(lo)); d.rectangle([1,1,T-2,T-2], fill=C(hi)); d.rectangle([2,2,T-3,T-3], fill=bg_b)
    for y in range(2, T-2):
        for x in range(2, T-2):
            tp[x, y] = bg_a if (x + y) % 2 == 0 and y < T//2 else bg_b
    for x, y in ((0,0),(T-1,0),(0,T-1),(T-1,T-1)): tp[x, y] = (0,0,0,0)
    t.alpha_composite(icon, (2, 2))
    # category marker: weapons = orange notch top-left, buffs = cyan notch top-left
    mc = C('ff9a2e') if kind == 'w' else C('3de0ff')
    for i in range(4):
        for j in range(4 - i): tp[1 + i, 1 + j] = mc
    if rarity == 'evolved':
        for i in range(0, T, 4): tp[min(T-1, i), 0] = C('ffffff'); tp[0, min(T-1, i)] = C('ffffff')
    return t

def font(sz, bold=False):
    f = '/usr/share/fonts/truetype/sand-box/google/Nanum Gothic/NanumGothic-%s.ttf' % ('Bold' if bold else 'Regular')
    return ImageFont.truetype(f, sz)

def main(path):
    Z = 4; T = (S + 4) * Z; cols = 5; cw = T + 44; ch = T + 66
    W = 940; H = 3000
    img = Image.new('RGB', (W, H), C('0a0f1d')[:3]); d = ImageDraw.Draw(img)
    d.text((20, 14), 'ASTER WING — Weapon & Buff Icon Sheet (CONCEPT v0)', font=font(26, True), fill=C('ffffff')[:3])
    d.text((20, 50), '24×24 px procedural placeholders, 4× upscale, NOT final art.  Frame = rarity · corner notch = type (orange weapon / cyan buff)',
           font=font(14), fill=C('9fb2d0')[:3])
    def section(title, items, kind, y0):
        d.text((20, y0), title, font=font(20, True), fill=C('ffd08a' if kind == 'w' else 'b8f6ff')[:3])
        for i, (en, ko, fn) in enumerate(items):
            r, c = divmod(i, cols); x = 20 + c * (cw + 20) + 22; y = y0 + 36 + r * ch
            img.paste(tile(fn, kind).resize((T, T), Image.NEAREST), (x, y), tile(fn, kind).resize((T, T), Image.NEAREST))
            d.text((x + T//2, y + T + 6), '%s%02d' % ('W' if kind == 'w' else 'B', i + 1), font=font(12), fill=C('6f819f')[:3], anchor='mt')
            d.text((x + T//2, y + T + 20), en, font=font(14, True), fill=C('ffffff')[:3], anchor='mt')
            d.text((x + T//2, y + T + 38), ko, font=font(14), fill=C('c8d4e8')[:3], anchor='mt')
        return y0 + 36 + 2 * ch + 6
    y = section('WEAPONS · 무기 10', WEAPONS, 'w', 90)
    y = section('BUFFS · 버프 10', BUFFS, 'b', y + 4)
    # legend
    d.text((20, y), 'RARITY FRAMES · 등급 테두리 (예: Twin Cannon, 진화 = Aurora Gatling 콘셉트)', font=font(20, True), fill=C('ffffff')[:3])
    x = 42
    for rk, lab in (('common', 'Common 일반'), ('uncommon', 'Uncommon 고급'), ('rare', 'Rare 희귀 (OVERCHARGED)'), ('evolved', 'Evolved 진화 (gold)')):
        t = tile(twin_cannon if rk != 'evolved' else aurora_gatling, 'w', rk).resize((T, T), Image.NEAREST); img.paste(t, (x, y + 36), t)
        d.text((x + T//2, y + 36 + T + 6), lab, font=font(13, True), fill=C('c8d4e8')[:3], anchor='mt'); x += T + 80
    # tiny-size readability strip
    y2 = y + 36 + T + 40
    d.text((20, y2), 'SIZE CHECK · 1× (24px) / 2× (48px, 모바일) 가독성 확인', font=font(16, True), fill=C('ffffff')[:3])
    yy = y2 + 30
    for kind, items in (('w', WEAPONS), ('b', BUFFS)):
        x = 22
        for en, ko, fn in items:
            t = tile(fn, kind); t2 = t.resize((t.width*2, t.height*2), Image.NEAREST)
            img.paste(t2, (x, yy), t2); img.paste(t, (x + 56 + 4, yy + 12), t); x += t2.width + 36
        yy += 62
    img = img.crop((0, 0, W, yy + 10))
    img.save(path); print(path, img.size)
if __name__ == '__main__':
    import sys; main(sys.argv[1] if len(sys.argv) > 1 else 'icons-concept.png')
