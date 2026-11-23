# 貸し借り帳のアイコンの絵（SVG）を作る：航海日誌と同じ羅針盤（背景）と、真鍮の硬貨（前）。tools/icons/make-icons.sh から呼ぶ
import math, sys
# mode: full（角丸の四角いアイコン）/ maskable（全面・中身を小さく）/ small（16〜48px）/ bg（背景だけ・全面）/ fg（硬貨だけ・透明）
def compass(cx=256, cy=256, s=1.0, ticks=True):
    o=[]
    R=210*s; r2=196*s; r3=178*s
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="none" stroke="#3C5A6E" stroke-width="{3*s:.1f}"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{r3}" fill="none" stroke="#3C5A6E" stroke-width="{1.6*s:.1f}" opacity="0.8"/>')
    for d in (range(0,360,10) if ticks else []):
        a=math.radians(d); L = r2-10*s if d%30==0 else r2
        x1,y1=cx+math.sin(a)*R, cy-math.cos(a)*R; x2,y2=cx+math.sin(a)*L, cy-math.cos(a)*L
        o.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#4F7286" stroke-width="{(3 if d%30==0 else 1.6)*s:.1f}" stroke-linecap="round"/>')
    # 8方位の星：対角（短い）→ 東西南北（長い）。片側を明るく、もう片側を暗く
    def point(deg, L, w, light, dark):
        a=math.radians(deg); ax,ay=math.sin(a),-math.cos(a); px,py=math.cos(a),math.sin(a)
        tip=(cx+ax*L, cy+ay*L); l=(cx+px*w, cy+py*w); r=(cx-px*w, cy-py*w)
        return (f'<polygon points="{cx},{cy} {tip[0]:.1f},{tip[1]:.1f} {l[0]:.1f},{l[1]:.1f}" fill="{light}"/>'
                f'<polygon points="{cx},{cy} {tip[0]:.1f},{tip[1]:.1f} {r[0]:.1f},{r[1]:.1f}" fill="{dark}"/>')
    for d in (45,135,225,315): o.append(point(d,132*s,20*s,'#33526A','#243B4E'))
    for d in (90,180,270): o.append(point(d,176*s,26*s,'#41657F','#2A4559'))
    o.append(point(0,176*s,26*s,'#E3C384','#A9823F'))  # 北は真鍮色
    return ''.join(o)

def coin(cx=256, cy=256, s=1.0, outline=True):
    # 真鍮の硬貨：縁・内側の目盛りの輪・まん中に ¥（字ではなく線で描く）
    def P(x, y): return f'{cx+(x-256)*s:.1f},{cy+(y-256)*s:.1f}'
    o = []
    if outline: o.append(f'<circle cx="{cx}" cy="{cy}" r="{150*s+12*s:.1f}" fill="#131E29"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{150*s:.1f}" fill="url(#brass)"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{124*s:.1f}" fill="none" stroke="#8E6B30" stroke-width="{5*s:.1f}" stroke-dasharray="{4*s:.1f} {9*s:.1f}"/>')
    o.append(f'<circle cx="{cx}" cy="{cy}" r="{108*s:.1f}" fill="none" stroke="#A9823F" stroke-width="{3*s:.1f}" opacity="0.8"/>')
    g = f'<g stroke="#2A3B4C" stroke-width="{24*s:.1f}" stroke-linecap="round" stroke-linejoin="round" fill="none">'
    g += f'<path d="M{P(196,170)} L{P(256,252)} L{P(316,170)}"/>'
    g += f'<path d="M{P(256,252)} L{P(256,348)}"/>'
    g += f'<path d="M{P(206,262)} L{P(306,262)}"/><path d="M{P(206,306)} L{P(306,306)}"/>'
    g += '</g>'
    o.append(g)
    return ''.join(o)

DEFS='''<defs>
<radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#20344A"/><stop offset="1" stop-color="#0E1720"/></radialGradient>
<linearGradient id="brass" gradientUnits="userSpaceOnUse" x1="0" y1="106" x2="0" y2="406"><stop offset="0" stop-color="#F0D59A"/><stop offset="0.55" stop-color="#D4AE68"/><stop offset="1" stop-color="#A9823F"/></linearGradient>
</defs>'''

def svg(mode):
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">', DEFS]
    if mode=='full':
        o.append('<rect width="512" height="512" rx="112" fill="url(#bg)"/>'); o.append(compass()); o.append(coin(s=0.84))
    elif mode=='maskable':
        o.append('<rect width="512" height="512" fill="url(#bg)"/>'); o.append(compass(s=0.8)); o.append(coin(s=0.8*0.84))
    elif mode=='small':  # 16〜48px：目盛りを省いて、錨を大きく
        o.append('<rect width="512" height="512" rx="112" fill="url(#bg)"/>'); o.append(compass(ticks=False)); o.append(coin(s=1.1, outline=False))
    elif mode=='bg':   # Android アダプティブアイコンの背景（108dp。見えるのは真ん中の 72dp ほど）
        o.append('<rect width="512" height="512" fill="url(#bg)"/>'); o.append(compass(s=0.74))
    elif mode=='fg':   # 前景（硬貨。真ん中の 66dp の安全な範囲に入れる）
        o.append(coin(s=0.56*0.95))
    o.append('</svg>')
    return ''.join(o)

for m in ('full','maskable','small','bg','fg'):
    open(f'{m}.svg','w').write(svg(m))
