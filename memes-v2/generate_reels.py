#!/usr/bin/env python3
# Strech meme system -> 1080x1920 (Instagram Reels / 9:16) SVGs
import base64, os, html

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

W,H = 1080,1920
MX = 84                 # side margin
FOOT_Y = 1690           # footer baseline band (kept above Reels bottom UI)

GREEN="#16A34A"; PINE="#0B2412"; PINE2="#0E2A17"
CREAM="#F6F3EC"; PAPER2="#EFEADD"; MINT="#E4F7EC"
INK="#16211A"; SAGE="#96A08F"; SAGE2="#5A6353"; GOLD="#C9A227"
LINE="#E3DED0"; LINEP="#1E3A28"
SERIF="Lora, Georgia, 'Times New Roman', serif"
SANS="Albert Sans, 'Helvetica Neue', Helvetica, Arial, sans-serif"

def mark(x,y,scale,fill,stroke,sw=15,op=1.0):
    return (f'<g transform="translate({x},{y}) scale({scale})" opacity="{op}">'
      f'<polygon points="0,40.5 59.4,0 59.4,63" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
      f'<polygon points="0,40.5 117.9,86.4 64.8,126 0,100.8" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
      f'<polygon points="117.9,86.4 117.9,145.8 64.8,180 64.8,126" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
      f'</g>')

def ghost(x,y,scale,c1,c2,op):
    return (f'<g transform="translate({x},{y}) scale({scale})" opacity="{op}">'
      f'<polygon points="0,40.5 59.4,0 59.4,63" fill="{c1}"/>'
      f'<polygon points="0,40.5 117.9,86.4 64.8,126 0,100.8" fill="{c1}"/>'
      f'<polygon points="117.9,86.4 117.9,145.8 64.8,180 64.8,126" fill="{c2}"/>'
      f'</g>')

def footer(dark=False, tag="Owning a home shouldn't require managing one."):
    y=FOOT_Y
    if dark:
        line=LINEP; word="#F3F1E8"; tg=SAGE; mk=mark(MX,y-2,0.34,GREEN,PINE,18)
    else:
        line=LINE; word=INK; tg=SAGE2; mk=mark(MX,y-2,0.34,GREEN,CREAM,18)
    return (
      f'<line x1="{MX}" y1="{y-36}" x2="{W-MX}" y2="{y-36}" stroke="{line}" stroke-width="2"/>'
      f'{mk}'
      f'<text x="{MX+68}" y="{y+38}" font-family="{SERIF}" font-weight="700" font-size="46" fill="{word}">Strech</text>'
      f'<line x1="{MX+240}" y1="{y+8}" x2="{MX+240}" y2="{y+38}" stroke="{tg}" stroke-width="1.5" opacity="0.5"/>'
      f'<text x="{MX+262}" y="{y+33}" font-family="{SANS}" font-size="23" fill="{tg}">{html.escape(tag)}</text>'
      f'<circle cx="{W-MX}" cy="{y+26}" r="6" fill="{GOLD}"/>'
      f'<text x="{W-MX-20}" y="{y+33}" text-anchor="end" font-family="{SANS}" font-size="20" font-weight="600" letter-spacing="2" fill="{tg}">BETA</text>'
    )

def label(x,y,txt,color):
    return (f'<text x="{x}" y="{y}" font-family="{SANS}" font-size="28" font-weight="600" '
            f'letter-spacing="3.5" fill="{color}">{html.escape(txt.upper())}</text>'
            f'<line x1="{x}" y1="{y+22}" x2="{x+72}" y2="{y+22}" stroke="{GOLD}" stroke-width="3"/>')

def svg(body,bg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<rect width="{W}" height="{H}" fill="{bg}"/>{body}</svg>')

memes={}

# ---------- 1. POV ----------
b = ghost(560,560,4.6,PAPER2,"#E7E2D4",1.0)
b += label(MX,400,"POV",SAGE2)
lines=["You're the","unpaid facilities","manager of a","building you","also live in."]
y=640
for L in lines:
    b+=f'<text x="{MX}" y="{y}" font-family="{SERIF}" font-weight="700" font-size="104" fill="{INK}">{L}</text>'
    y+=120
b+=f'<text x="{MX}" y="{y+50}" font-family="{SANS}" font-size="36" fill="{SAGE2}">And somehow you never applied for the job.</text>'
memes["strech-reel-01-pov-facilities-manager"]=svg(b,CREAM)

# ---------- 2. NOBODY ----------
b = ghost(560,900,4.4,PINE2,"#0A1F11",1.0)
b += f'<text x="{MX}" y="430" font-family="{SANS}" font-size="52" font-weight="500" fill="#C9D3C4">Nobody:</text>'
b += f'<text x="{MX}" y="520" font-family="{SANS}" font-size="52" font-weight="500" fill="#C9D3C4">Absolutely nobody:</text>'
b += f'<line x1="{MX}" y1="588" x2="{W-MX}" y2="588" stroke="{LINEP}" stroke-width="2"/>'
b += f'<text x="{MX}" y="680" font-family="{SANS}" font-size="36" fill="{SAGE}">Your water heater, 2 a.m., the night</text>'
b += f'<text x="{MX}" y="728" font-family="{SANS}" font-size="36" fill="{SAGE}">before ten guests arrive:</text>'
b += f'<text x="{MX}" y="1000" font-family="{SERIF}" font-weight="700" font-size="118" fill="#F3F1E8">“Okay.</text>'
b += f'<text x="{MX}" y="1130" font-family="{SERIF}" font-weight="700" font-size="118" fill="#F3F1E8">I’m ready</text>'
b += f'<text x="{MX}" y="1260" font-family="{SERIF}" font-weight="700" font-size="118" fill="{GREEN}">to go now.”</text>'
memes["strech-reel-02-nobody-water-heater"]=svg(b,PINE)

# ---------- 3. SAME PICTURE (stacked) ----------
b = label(MX,400,"Find the difference",SAGE2)
# panel A
b += f'<rect x="{MX}" y="470" width="912" height="290" rx="28" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="540" y="600" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="56" fill="{INK}">“I’ll get to it</text>'
b += f'<text x="540" y="668" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="56" fill="{INK}">this weekend.”</text>'
# seam mark
b += ghost(486,760,1.55,"#EFEADD","#E7E2D4",0.85)
# panel B
b += f'<rect x="{MX}" y="1010" width="912" height="290" rx="28" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="540" y="1140" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="56" fill="{INK}">“I’ll never</text>'
b += f'<text x="540" y="1208" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="56" fill="{INK}">get to it.”</text>'
b += f'<text x="540" y="1460" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="72" fill="{GREEN}">They’re the same picture.</text>'
b += f'<text x="540" y="1520" text-anchor="middle" font-family="{SANS}" font-size="30" fill="{SAGE2}">One of them, we can fix.</text>'
memes["strech-reel-03-same-picture"]=svg(b,CREAM)

# ---------- 4. DRAKE / escalation ----------
b = label(MX,400,"How the job actually gets done",SAGE2)
rows=[("Ask the neighbor if they know a guy",False),
      ("Post in the group chat, get 40 replies",False),
      ("Text the guy from 2019. No response.",False),
      ("Book it. Someone comes.",True)]
y=580
for txt,ok in rows:
    if ok:
        b += f'<rect x="{MX}" y="{y-64}" width="912" height="176" rx="28" fill="{MINT}"/>'
        b += mark(MX+40,y-46,0.40,GREEN,MINT,16)
        b += f'<text x="{MX+150}" y="{y+36}" font-family="{SERIF}" font-weight="700" font-size="60" fill="{INK}">{txt}</text>'
    else:
        b += f'<text x="{MX+36}" y="{y+16}" font-family="{SANS}" font-size="48" fill="{SAGE}">✗</text>'
        b += f'<text x="{MX+110}" y="{y+16}" font-family="{SANS}" font-size="44" fill="{SAGE2}">{html.escape(txt)}</text>'
        b += f'<line x1="{MX+110}" y1="{y-2}" x2="{W-MX-40}" y2="{y-2}" stroke="{SAGE}" stroke-width="1.6" opacity="0.35"/>'
        y+=150
memes["strech-reel-04-just-book-it"]=svg(b,CREAM)

# ---------- 5. TEXT THREAD ----------
b = label(MX,400,"Household group chat",SAGE2)
b += f'<rect x="{MX}" y="500" width="720" height="180" rx="42" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="{MX+42}" y="578" font-family="{SANS}" font-size="40" fill="{INK}">did you ever call someone</text>'
b += f'<text x="{MX+42}" y="632" font-family="{SANS}" font-size="40" fill="{INK}">about the gutters</text>'
b += f'<rect x="{W-MX-620}" y="760" width="620" height="128" rx="42" fill="{GREEN}"/>'
b += f'<text x="{W-MX-40}" y="838" text-anchor="end" font-family="{SANS}" font-size="40" fill="#FFFFFF">yeah all handled \U0001F44D</text>'
b += f'<text x="{W-MX-40}" y="928" text-anchor="end" font-family="{SANS}" font-size="27" fill="{SAGE2}">Delivered · a lie · it has been eight months</text>'
b += f'<text x="{MX}" y="1180" font-family="{SERIF}" font-weight="700" font-size="76" fill="{INK}">Strech doesn’t judge.</text>'
b += f'<text x="{MX}" y="1268" font-family="{SERIF}" font-weight="700" font-size="76" fill="{GREEN}">It just shows up.</text>'
memes["strech-reel-05-gutters-text"]=svg(b,CREAM)

# ---------- 6. THE WINDOW ----------
b = ghost(560,760,3.6,PINE2,"#0A1F11",1.0)
b += label(MX,400,"The arrival window",SAGE)
b += f'<text x="{MX}" y="640" font-family="{SERIF}" font-weight="700" font-size="150" fill="#F3F1E8">“Between</text>'
b += f'<text x="{MX}" y="800" font-family="{SERIF}" font-weight="700" font-size="150" fill="#F3F1E8">8 and 4.”</text>'
b += f'<text x="{MX}" y="920" font-family="{SANS}" font-size="38" fill="{SAGE}">My entire Saturday, held hostage</text>'
b += f'<text x="{MX}" y="972" font-family="{SANS}" font-size="38" fill="{SAGE}">by someone else’s schedule.</text>'
b += f'<rect x="{MX}" y="1080" width="912" height="30" rx="15" fill="{LINEP}"/>'
b += f'<rect x="{MX}" y="1080" width="820" height="30" rx="15" fill="{GOLD}"/>'
b += f'<text x="{MX}" y="1160" font-family="{SANS}" font-size="28" fill="{SAGE}">8:00 AM</text>'
b += f'<text x="{W-MX}" y="1160" text-anchor="end" font-family="{SANS}" font-size="28" fill="{SAGE}">3:58 PM · still waiting</text>'
b += f'<text x="{MX}" y="1320" font-family="{SERIF}" font-weight="700" font-size="60" fill="{GREEN}">We wait. You don’t.</text>'
memes["strech-reel-06-arrival-window"]=svg(b,PINE)

# write
gallery=[]
for name,doc in memes.items():
    dark = name in ("strech-reel-02-nobody-water-heater","strech-reel-06-arrival-window")
    doc = doc.replace("</svg>", footer(dark=dark)+"</svg>")
    p=os.path.join(OUT,name+".svg"); open(p,"w").write(doc)
    print("wrote",p,len(doc))
print("done", len(memes))
