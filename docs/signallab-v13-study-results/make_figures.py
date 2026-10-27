"""Publication-style vector figures from independently verified sealed aggregates."""
import json, math, pathlib, sys
from reportlab.graphics.shapes import Drawing, Line, String, Circle, Polygon
from reportlab.graphics import renderPDF, renderSVG
from reportlab.lib import colors

out = pathlib.Path(sys.argv[1]).resolve()
audit = json.loads((out/'audit-summary.json').read_text(encoding='utf-8'))
agg = json.loads((out/'aggregate.json').read_text(encoding='utf-8'))
assert agg['head'] == audit['head'] and agg['auditedTrials'] == 36000 and audit['formalFixedHorizonComplete']
records = {(r['energy'],r['layout'],r['channel'],r['ebN0Db']):r for r in agg['records']}
dbs = (0,8,16,24)
blue, orange, green, purple = map(colors.HexColor, ('#1764a6','#cf5b16','#16805d','#7d4ea6'))
grey = colors.HexColor('#d7dde5'); black = colors.HexColor('#202831')

def text(d,x,y,s,size=10,color=black,anchor='start'):
    d.add(String(x,y,s,fontName='Helvetica',fontSize=size,fillColor=color,textAnchor=anchor))
def line(d,x1,y1,x2,y2,color=black,width=1,dash=None):
    d.add(Line(x1,y1,x2,y2,strokeColor=color,strokeWidth=width,strokeDashArray=dash))
def point(d,x,y,color):
    d.add(Circle(x,y,3.4,fillColor=color,strokeColor=color))
def box(d,x,y,w,h,title,ticks,ymin,ymax,fmt=lambda v:str(v)):
    text(d,x,y+h+13,title,12)
    for v in ticks:
        yy=y+(v-ymin)/(ymax-ymin)*h
        line(d,x,yy,x+w,yy,grey,0.6); text(d,x-8,yy-3,fmt(v),8,anchor='end')
    line(d,x,y,x,y+h); line(d,x,y,x+w,y)
    for snr in dbs:
        xx=x+(snr/24)*w; line(d,xx,y,xx,y-4); text(d,xx,y-16,str(snr),8,anchor='middle')
    return lambda snr:x+snr/24*w, lambda val:y+(val-ymin)/(ymax-ymin)*h
def save(d,name):
    for suffix,content in [('.pdf',renderPDF.drawToString(d)),('.svg',renderSVG.drawToString(d).encode('utf-8'))]:
        with (out/(name+suffix)).open('xb') as f: f.write(content)

# Every displayed interval is one of the 32 preregistered simultaneous intervals.
d=Drawing(940,650); text(d,35,620,'Paired BER differences: simultaneous 95% intervals',18)
text(d,35,602,'Absolute percentage points; x-axis Eb/N0 (dB); full independent trial vectors n=36,000',10)
for j,(energy,ch) in enumerate((('data-eb','awgn'),('data-eb','rayleigh'),('total-eb','awgn'),('total-eb','rayleigh'))):
    x=90+(j%2)*430; y=355-(j//2)*250
    xx,yy=box(d,x,y,335,175,energy+'  /  '+ch.upper(),(-5,0,5,10),-7,11,lambda v:str(v))
    line(d,x,yy(0),x+335,yy(0),colors.HexColor('#6b7280'),1)
    for contrast,col,offset in ((0,blue,-5),(1,orange,5)):
        for snr in dbs:
            r=next(r for r in audit['primaryComparisons'] if (r['energy'],r['channel'],r['ebN0Db'],r['contrast'])==(energy,ch,snr,contrast))
            a,b=[v*100 for v in r['simultaneous95Interval']]; v=r['observedDifferenceBounds'][0]*100; px=xx(snr)+offset
            line(d,px,yy(a),px,yy(b),col,1.7); line(d,px-3,yy(a),px+3,yy(a),col); line(d,px-3,yy(b),px+3,yy(b),col); point(d,px,yy(v),col)
text(d,35,37,'Blue: P8 comb ZF - P8 training ZF     Orange: P4 comb ZF - P8 comb ZF',10)
text(d,35,20,'Positive means the left-hand BER is higher. Intervals including zero do not prove equivalence.',9)
save(d,'figure-1-ber-differences-v2')

d=Drawing(940,650); text(d,35,620,'Common-data BER by SNR (descriptive)',18)
text(d,35,602,'x-axis Eb/N0 (dB); log scale; pooled BER curves are descriptive, without confidence intervals',10)
curves=((1,'ideal-zf',green,'P8 ideal CSI ZF'),(1,'training-zf',blue,'P8 training LS ZF'),(1,'comb-zf',orange,'P8 comb LS ZF'),(0,'comb-zf',purple,'P4 comb LS ZF'))
for j,(energy,ch) in enumerate((('data-eb','awgn'),('data-eb','rayleigh'),('total-eb','awgn'),('total-eb','rayleigh'))):
    x=90+(j%2)*430; y=355-(j//2)*250
    xx,yy=box(d,x,y,335,175,energy+'  /  '+ch.upper(),(-6,-4,-2,0),-6,0,lambda v:'1e'+str(v))
    for curve_index,(layout,method,col,label) in enumerate(curves):
        last=None
        for snr in dbs:
            m=records[(energy,layout,ch,snr)]['methods'][method]; ber=m['errors']/m['bits']; px=xx(snr)+(curve_index-1.5)*4
            if ber == 0 or ber < 1e-6:
                d.add(Polygon([px-4,y+7,px+4,y+7,px,y+1],fillColor=None,strokeColor=col,strokeWidth=1)); last=None
            else:
                py=yy(math.log10(ber))
                if last: line(d,last[0],last[1],px,py,col,1.4)
                point(d,px,py,col); last=(px,py)
for i,(_,_,col,label) in enumerate(curves): text(d,35+(i%2)*435,53-(i//2)*15,label,9,col)
text(d,35,17,'Small horizontal offsets separate curves. Down triangles: zero observed or below plot floor, not zero BER.',9)
save(d,'figure-2-ber-snr-v2')

d=Drawing(940,440); text(d,35,412,'Rayleigh: comb channel estimation and noiseless interpolation bias',16)
text(d,35,395,'x-axis Eb/N0 (dB); common-data mean squared error per tone; descriptive, no confidence intervals',10)
for j,energy in enumerate(('data-eb','total-eb')):
    x=90+j*430; y=115
    xx,yy=box(d,x,y,335,235,energy,(-3,-2,-1,0),-3,0,lambda v:'1e'+str(v))
    for layout,col in ((0,purple),(1,orange)):
        for field,dash in (('combError',None),('bias',[4,3])):
            last=None
            for snr in dbs:
                r=records[(energy,layout,'rayleigh',snr)]; v=r[field]/r['tones']; px=xx(snr); py=yy(math.log10(v))
                if last: line(d,last[0],last[1],px,py,col,1.5,dash)
                if field=='combError': point(d,px,py,col)
                last=(px,py)
text(d,35,66,'Purple: P4      Orange: P8     Solid: measured estimate MSE     Dashed: noiseless interpolation bias',9)
text(d,35,48,'Bias is computed from the true channel for evaluation only; it is not receiver input.',9)
text(d,35,29,'Values at finite SNR suggest bias domination here; they do not establish an infinite-SNR BER limit.',9)
save(d,'figure-3-rayleigh-estimation-v2')
print('Created six vector figures (PDF + SVG); no raw data modified.')
