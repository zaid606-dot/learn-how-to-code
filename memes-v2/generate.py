#!/usr/bin/env python3
# Strech meme system generator -> 1080x1080 SVGs (Instagram square)
import base64, os, html

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

# --- palette ---
GREEN="#16A34A"; PINE="#0B2412"; PINE2="#0E2A17"
CREAM="#F6F3EC"; PAPER2="#EFEADD"; MINT="#E4F7EC"
INK="#16211A"; SAGE="#96A08F"; SAGE2="#5A6353"; GOLD="#C9A227"
LINE="#E3DED0"; LINEP="#1E3A28"

SERIF="Lora, Georgia, 'Times New Roman', serif"
SANS="Albert Sans, 'Helvetica Neue', Helvetica, Arial, sans-serif"

# isometric mark (native ~118 x 180). fill/stroke passed in.
def mark(x, y, scale, fill, stroke, sw=15, op=1.0):
    return (f'<g transform="translate({x},{y}) scale({scale})" opacity="{op}">'
      f'<polygon points="0,40.5 59.4,0 59.4,63" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
      f'<polygon points="0,40.5 117.9,86.4 64.8,126 0,100.8" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
      f'<polygon points="117.9,86.4 117.9,145.8 64.8,180 64.8,126" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
      f'</g>')

# ghost watermark (no stroke, faceted tonal)
def ghost(x, y, scale, c1, c2, op):
    return (f'<g transform="translate({x},{y}) scale({scale})" opacity="{op}">'
      f'<polygon points="0,40.5 59.4,0 59.4,63" fill="{c1}"/>'
      f'<polygon points="0,40.5 117.9,86.4 64.8,126 0,100.8" fill="{c1}"/>'
      f'<polygon points="117.9,86.4 117.9,145.8 64.8,180 64.8,126" fill="{c2}"/>'
      f'</g>')

def footer(dark=False, tag="Owning a home shouldn't require managing one."):
    y=980
    if dark:
        line=LINEP; word="#F3F1E8"; tg=SAGE; mk=mark(84,y-2,0.30,GREEN,PINE,18)
        gold=GOLD
    else:
        line=LINE; word=INK; tg=SAGE2; mk=mark(84,y-2,0.30,GREEN,CREAM,18)
        gold=GOLD
    return (
      f'<line x1="84" y1="{y-34}" x2="996" y2="{y-34}" stroke="{line}" stroke-width="2"/>'
      f'{mk}'
      f'<text x="140" y="{y+34}" font-family="{SERIF}" font-weight="700" font-size="40" fill="{word}">Strech</text>'
      f'<line x1="290" y1="{y+8}" x2="290" y2="{y+34}" stroke="{tg}" stroke-width="1.5" opacity="0.5"/>'
      f'<text x="310" y="{y+30}" font-family="{SANS}" font-size="20" fill="{tg}">{html.escape(tag)}</text>'
      f'<circle cx="984" cy="{y+22}" r="5" fill="{gold}"/>'
      f'<text x="968" y="{y+28}" text-anchor="end" font-family="{SANS}" font-size="17" font-weight="600" letter-spacing="1.5" fill="{tg}">BETA</text>'
    )

def label(x,y,txt,color):
    return (f'<text x="{x}" y="{y}" font-family="{SANS}" font-size="24" font-weight="600" '
            f'letter-spacing="3" fill="{color}">{html.escape(txt.upper())}</text>')

def svg(body, bg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">'
            f'<rect width="1080" height="1080" fill="{bg}"/>{body}</svg>')

memes = {}

# ---- 1. POV — the thesis ----
b = ghost(560,150,3.4,PAPER2,"#E7E2D4",1.0)
b += label(84,150,"POV",SAGE2)
b += f'<line x1="84" y1="168" x2="150" y2="168" stroke="{GOLD}" stroke-width="3"/>'
lines=["You're the unpaid","facilities manager","of a building you","also live in."]
y=300
for L in lines:
    b+=f'<text x="84" y="{y}" font-family="{SERIF}" font-weight="700" font-size="82" fill="{INK}">{L}</text>'
    y+=96
b+=f'<text x="84" y="{y+30}" font-family="{SANS}" font-size="30" fill="{SAGE2}">And somehow you never applied for the job.</text>'
memes["strech-meme-01-pov-facilities-manager"]=svg(b,CREAM)

# ---- 2. NOBODY — water heater 2AM (dark) ----
b = ghost(600,470,3.2,PINE2,"#0A1F11",1.0)
b += f'<text x="84" y="180" font-family="{SANS}" font-size="40" font-weight="500" fill="#C9D3C4">Nobody:</text>'
b += f'<text x="84" y="250" font-family="{SANS}" font-size="40" font-weight="500" fill="#C9D3C4">Absolutely nobody:</text>'
b += f'<line x1="84" y1="300" x2="996" y2="300" stroke="{LINEP}" stroke-width="2"/>'
b += f'<text x="84" y="372" font-family="{SANS}" font-size="30" fill="{SAGE}">Your water heater, 2 a.m., the night</text>'
b += f'<text x="84" y="412" font-family="{SANS}" font-size="30" fill="{SAGE}">before ten guests arrive:</text>'
b += f'<text x="84" y="560" font-family="{SERIF}" font-weight="700" font-size="88" fill="#F3F1E8">“Okay.</text>'
b += f'<text x="84" y="664" font-family="{SERIF}" font-weight="700" font-size="88" fill="#F3F1E8">I’m ready</text>'
b += f'<text x="84" y="768" font-family="{SERIF}" font-weight="700" font-size="88" fill="{GREEN}">to go now.”</text>'
memes["strech-meme-02-nobody-water-heater"]=svg(b,PINE)

# ---- 3. SAME PICTURE — two panels ----
b = label(84,150,"Corporate needs you to find the difference",SAGE2)
b += f'<line x1="84" y1="168" x2="150" y2="168" stroke="{GOLD}" stroke-width="3"/>'
# panel A
b += f'<rect x="84" y="220" width="440" height="300" rx="24" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="304" y="360" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="40" fill="{INK}">“I’ll get to it</text>'
b += f'<text x="304" y="410" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="40" fill="{INK}">this weekend.”</text>'
# panel B
b += f'<rect x="556" y="220" width="440" height="300" rx="24" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="776" y="360" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="40" fill="{INK}">“I’ll never</text>'
b += f'<text x="776" y="410" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="40" fill="{INK}">get to it.”</text>'
b += f'<text x="540" y="700" text-anchor="middle" font-family="{SERIF}" font-weight="700" font-size="72" fill="{GREEN}">They’re the same picture.</text>'
b += f'<text x="540" y="760" text-anchor="middle" font-family="{SANS}" font-size="28" fill="{SAGE2}">One of them, we can fix.</text>'
b += ghost(470,300,1.4,"#EFEADD","#E7E2D4",0.5)
memes["strech-meme-03-same-picture"]=svg(b,CREAM)

# ---- 4. DRAKE / escalation ----
b = label(84,150,"How the job actually gets done",SAGE2)
b += f'<line x1="84" y1="168" x2="150" y2="168" stroke="{GOLD}" stroke-width="3"/>'
rows=[("Ask the neighbor if they know a guy",False),
      ("Post in the group chat, get 40 replies",False),
      ("Text the guy from 2019. No response.",False),
      ("Book it. Someone comes.",True)]
y=290
for txt,ok in rows:
    if ok:
        b += f'<rect x="84" y="{y-56}" width="912" height="150" rx="24" fill="{MINT}"/>'
        b += mark(120,y-40,0.34,GREEN,MINT,16)
        b += f'<text x="230" y="{y+30}" font-family="{SERIF}" font-weight="700" font-size="56" fill="{INK}">{txt}</text>'
        y+=170
    else:
        b += f'<text x="120" y="{y+18}" font-family="{SANS}" font-size="42" fill="{SAGE}">✗</text>'
        b += f'<text x="185" y="{y+18}" font-family="{SANS}" font-size="40" fill="{SAGE2}">{html.escape(txt)}</text>'
        b += f'<line x1="185" y1="{y+2}" x2="920" y2="{y+2}" stroke="{SAGE}" stroke-width="1.4" opacity="0.35"/>'
        y+=110
memes["strech-meme-04-just-book-it"]=svg(b,CREAM)

# ---- 5. TEXT THREAD — the gutters lie ----
b = label(84,150,"Household group chat",SAGE2)
b += f'<line x1="84" y1="168" x2="150" y2="168" stroke="{GOLD}" stroke-width="3"/>'
# incoming
b += f'<rect x="84" y="230" width="620" height="110" rx="34" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="120" y="298" font-family="{SANS}" font-size="34" fill="{INK}">did you ever book someone</text>'
b += f'<text x="120" y="298" font-family="{SANS}" font-size="34" fill="{INK}" opacity="0"> </text>'
b += f'<text x="120" y="298" font-family="{SANS}" font-size="34" fill="{INK}"></text>'
# fix: put full text on two lines
b = label(84,150,"Household group chat",SAGE2)
b += f'<line x1="84" y1="168" x2="150" y2="168" stroke="{GOLD}" stroke-width="3"/>'
b += f'<rect x="84" y="220" width="660" height="150" rx="36" fill="#FFFFFF" stroke="{LINE}" stroke-width="2"/>'
b += f'<text x="122" y="284" font-family="{SANS}" font-size="34" fill="{INK}">did you ever call someone</text>'
b += f'<text x="122" y="330" font-family="{SANS}" font-size="34" fill="{INK}">about the gutters</text>'
# outgoing (green)
b += f'<rect x="440" y="420" width="556" height="110" rx="36" fill="{GREEN}"/>'
b += f'<text x="966" y="488" text-anchor="end" font-family="{SANS}" font-size="34" fill="#FFFFFF">yeah all handled \U0001F44D</text>'
b += f'<text x="966" y="566" text-anchor="end" font-family="{SANS}" font-size="24" fill="{SAGE2}">Delivered · a lie · it has been eight months</text>'
b += f'<text x="84" y="720" font-family="{SERIF}" font-weight="700" font-size="60" fill="{INK}">Strech doesn’t judge.</text>'
b += f'<text x="84" y="790" font-family="{SERIF}" font-weight="700" font-size="60" fill="{GREEN}">It just shows up.</text>'
memes["strech-meme-05-gutters-text"]=svg(b,CREAM)

# ---- 6. THE WINDOW (dark) ----
b = ghost(640,150,2.6,PINE2,"#0A1F11",1.0)
b += label(84,150,"The arrival window",SAGE)
b += f'<line x1="84" y1="168" x2="150" y2="168" stroke="{GOLD}" stroke-width="3"/>'
b += f'<text x="84" y="330" font-family="{SERIF}" font-weight="700" font-size="112" fill="#F3F1E8">“Between</text>'
b += f'<text x="84" y="452" font-family="{SERIF}" font-weight="700" font-size="112" fill="#F3F1E8">8 and 4.”</text>'
b += f'<text x="84" y="540" font-family="{SANS}" font-size="32" fill="{SAGE}">My entire Saturday, held hostage</text>'
b += f'<text x="84" y="584" font-family="{SANS}" font-size="32" fill="{SAGE}">by someone else’s schedule.</text>'
# wasted-day bar
b += f'<rect x="84" y="660" width="912" height="26" rx="13" fill="{LINEP}"/>'
b += f'<rect x="84" y="660" width="820" height="26" rx="13" fill="{GOLD}"/>'
b += f'<text x="84" y="726" font-family="{SANS}" font-size="24" fill="{SAGE}">8:00 AM</text>'
b += f'<text x="996" y="726" text-anchor="end" font-family="{SANS}" font-size="24" fill="{SAGE}">3:58 PM · still waiting</text>'
b += f'<text x="84" y="838" font-family="{SERIF}" font-weight="700" font-size="46" fill="{GREEN}">We wait. You don’t.</text>'
memes["strech-meme-06-arrival-window"]=svg(b,PINE)

# ---- write files + footers ----
gallery=[]
for name,doc in memes.items():
    dark = name in ("strech-meme-02-nobody-water-heater","strech-meme-06-arrival-window")
    ft = footer(dark=dark)
    doc = doc.replace("</svg>", ft+"</svg>")
    path=os.path.join(OUT,name+".svg")
    open(path,"w").write(doc)
    b64=base64.b64encode(doc.encode()).decode()
    gallery.append((name,b64))
    print("wrote",path,len(doc),"bytes")

# emit base64 manifest for the artifact
with open(os.path.join(OUT,"_b64.txt"),"w") as f:
    for name,b64 in gallery:
        f.write(name+"\n"+b64+"\n")
print("done", len(memes), "memes")
