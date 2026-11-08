"""Generates synthetic academic-paper PDFs used to test the import pipeline.

Run: python3 fixtures/make_fixtures.py  (needs reportlab, pillow, pypdfium2)
"""
import io, math, os, random, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, FrameBreak,
                                NextPageTemplate, Table, TableStyle, Image, KeepTogether)
from reportlab.graphics.shapes import Drawing, Rect, Line, String, PolyLine
from reportlab.lib import colors
from PIL import Image as PImage, ImageDraw, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
random.seed(7)

WORDS = ("model data learning results method training performance approach network layer attention "
         "sequence representation baseline evaluation dataset accuracy robust efficient propose show "
         "significant improvement analysis feature task language transfer domain general structure").split()

def sentence(n=None):
    n = n or random.randint(10, 22)
    w = [random.choice(WORDS) for _ in range(n)]
    w[0] = w[0].capitalize()
    return " ".join(w) + "."

def para(k=None):
    return " ".join(sentence() for _ in range(k or random.randint(4, 7)))

body = ParagraphStyle('body', fontName='Times-Roman', fontSize=10, leading=12, alignment=TA_JUSTIFY, firstLineIndent=12)
body0 = ParagraphStyle('body0', parent=body, firstLineIndent=0)
title = ParagraphStyle('title', fontName='Times-Bold', fontSize=17, leading=21, alignment=TA_CENTER, spaceAfter=10)
authors = ParagraphStyle('authors', fontName='Times-Roman', fontSize=11, leading=14, alignment=TA_CENTER)
affil = ParagraphStyle('affil', fontName='Times-Italic', fontSize=9, leading=11, alignment=TA_CENTER, spaceAfter=10)
h1 = ParagraphStyle('h1', fontName='Times-Bold', fontSize=12, leading=14, spaceBefore=8, spaceAfter=4)
h2 = ParagraphStyle('h2', fontName='Times-Bold', fontSize=10, leading=12, spaceBefore=6, spaceAfter=3)
abs_h = ParagraphStyle('absh', fontName='Times-Bold', fontSize=12, leading=14, alignment=TA_CENTER, spaceAfter=4)
abs_b = ParagraphStyle('absb', parent=body0, leftIndent=36, rightIndent=36)
cap = ParagraphStyle('cap', fontName='Times-Roman', fontSize=9, leading=11, spaceBefore=4, spaceAfter=8)
ref = ParagraphStyle('ref', fontName='Times-Roman', fontSize=8.5, leading=10, leftIndent=14, firstLineIndent=-14, spaceAfter=2)
eq = ParagraphStyle('eq', fontName='Times-Italic', fontSize=10, leading=14, alignment=TA_CENTER, spaceBefore=4, spaceAfter=4)

def chart():
    d = Drawing(230, 140)
    d.add(Line(30, 20, 30, 130, strokeWidth=0.8))
    d.add(Line(30, 20, 225, 20, strokeWidth=0.8))
    vals = [40, 75, 60, 95, 82]
    for i, v in enumerate(vals):
        d.add(Rect(42 + i * 36, 20, 24, v, fillColor=colors.HexColor('#4a78b5'), strokeColor=None))
        d.add(String(48 + i * 36, 8, f"M{i+1}", fontName='Helvetica', fontSize=7))
    for t in range(0, 101, 25):
        d.add(String(10, 18 + t, str(t), fontName='Helvetica', fontSize=7))
    d.add(PolyLine([42, 50, 90, 80, 140, 70, 190, 110], strokeColor=colors.red, strokeWidth=1.2))
    return d

def photo():
    img = PImage.new('RGB', (360, 220))
    px = img.load()
    for x in range(360):
        for y in range(220):
            px[x, y] = (int(120 + 100 * math.sin(x / 30)), int(80 + y / 2), int(200 - x / 3))
    dr = ImageDraw.Draw(img)
    dr.ellipse((120, 50, 240, 170), fill=(240, 220, 80))
    b = io.BytesIO(); img.save(b, 'PNG'); b.seek(0)
    return Image(b, width=215, height=131)

def booktabs():
    data = [["Method", "BLEU", "Params"], ["Baseline", "25.8", "65M"], ["Ours (small)", "27.3", "70M"], ["Ours (large)", "28.4", "213M"]]
    t = Table(data, colWidths=[90, 50, 50])
    t.setStyle(TableStyle([('FONT', (0, 0), (-1, -1), 'Times-Roman', 9), ('FONT', (0, 0), (-1, 0), 'Times-Bold', 9),
                           ('LINEABOVE', (0, 0), (-1, 0), 1, colors.black), ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.black),
                           ('LINEBELOW', (0, -1), (-1, -1), 1, colors.black), ('ALIGN', (1, 0), (-1, -1), 'CENTER')]))
    return t

def on_page(c, doc):
    c.saveState()
    c.setFont('Times-Italic', 8)
    c.drawString(72, letter[1] - 40, "Preprint. Under review at the Conference on Synthetic Papers.")
    c.setFont('Times-Roman', 9)
    c.drawCentredString(letter[0] / 2, 30, str(doc.page))
    c.restoreState()

def build_paper(path):
    W, H = letter
    m = 0.75 * inch
    gap = 0.25 * inch
    colw = (W - 2 * m - gap) / 2
    top_h = 3.3 * inch
    first = [Frame(m, H - m - top_h, W - 2 * m, top_h, id='top'),
             Frame(m, m, colw, H - 2 * m - top_h, id='l1'), Frame(m + colw + gap, m, colw, H - 2 * m - top_h, id='r1')]
    rest = [Frame(m, m, colw, H - 2 * m, id='l'), Frame(m + colw + gap, m, colw, H - 2 * m, id='r')]
    doc = BaseDocTemplate(path, pagesize=letter, title="Attentive Synthetic Networks for Reading", author="Ana Souza; Bruno Lima")
    doc.addPageTemplates([PageTemplate('first', first, onPage=on_page), PageTemplate('rest', rest, onPage=on_page)])
    s = []
    s.append(Paragraph("Attentive Synthetic Networks for Comfortable Reading of Academic Papers", title))
    s.append(Paragraph("Ana Souza<super>1</super>, Bruno Lima<super>2</super>, and Carla Mendes<super>1</super>", authors))
    s.append(Paragraph("<super>1</super>University of Lisbon &nbsp;&nbsp; <super>2</super>Institute of Reading Research", affil))
    s.append(Paragraph("Abstract", abs_h))
    s.append(Paragraph(para(5), abs_b))
    s.append(NextPageTemplate('rest'))
    s.append(FrameBreak())
    s.append(Paragraph("1 Introduction", h1))
    for i in range(3):
        s.append(Paragraph(para(), body0 if i == 0 else body))
    s.append(KeepTogether([chart(), Paragraph("Figure 1: Accuracy of the five models on the synthetic benchmark. The red line shows the running baseline.", cap)]))
    s.append(Paragraph(para(), body))
    s.append(Paragraph("2 Related Work", h1))
    s.append(Paragraph("2.1 Reading interfaces", h2))
    for i in range(2):
        s.append(Paragraph(para(), body0 if i == 0 else body))
    s.append(Paragraph("We define the attention score as", body0))
    s.append(Paragraph("A(Q, K, V) = softmax(QK<super>T</super> / &#8730;d) V &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (1)", eq))
    s.append(Paragraph("where " + para(2), body0))
    s.append(Paragraph("2.2 Document understanding", h2))
    for i in range(4):
        s.append(Paragraph(para(), body0 if i == 0 else body))
    s.append(KeepTogether([Paragraph("Table 1: Results on the synthetic translation benchmark.", cap), booktabs(), Spacer(1, 8)]))
    s.append(Paragraph("3 Experiments", h1))
    for i in range(3):
        s.append(Paragraph(para(), body0 if i == 0 else body))
    s.append(KeepTogether([photo(), Paragraph("Figure 2: A raster photograph embedded in the paper.", cap)]))
    for i in range(4):
        s.append(Paragraph(para(), body))
    s.append(Paragraph("4 Conclusion", h1))
    s.append(Paragraph(para(), body0))
    s.append(Paragraph("References", h1))
    for i in range(8):
        s.append(Paragraph(f"[{i+1}] A. Author and B. Writer. {sentence(12)} In <i>Proceedings of the Synthetic Conference</i>, pages {10*i+1}-{10*i+9}, 20{10+i}.", ref))
    doc.build(s)

def rasterize(src, dpi=200, skew=0.6):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(src)
    pages = []
    for i in range(len(pdf)):
        img = pdf[i].render(scale=dpi / 72).to_pil().convert('L')
        img = img.rotate(random.uniform(-skew, skew), expand=False, fillcolor=255, resample=PImage.BICUBIC)
        # paper tone and speckle noise
        img = img.point(lambda v: int(v * 0.92 + 8))
        dr = ImageDraw.Draw(img)
        for _ in range(400):
            x, y = random.randrange(img.width), random.randrange(img.height)
            dr.point((x, y), fill=random.randint(60, 160))
        img = img.filter(ImageFilter.GaussianBlur(0.4))
        pages.append(img)
    return pages

def build_scans(src):
    pages = rasterize(src)
    pages[0].save(os.path.join(OUT, 'scanned-paper.pdf'), save_all=True, append_images=pages[1:], resolution=200)
    # Two-page spreads with a gutter shadow, like a photocopied book or journal.
    spreads = []
    for i in range(0, len(pages), 2):
        a = pages[i]
        b = pages[i + 1] if i + 1 < len(pages) else PImage.new('L', a.size, 235)
        sp = PImage.new('L', (a.width * 2, a.height), 235)
        sp.paste(a, (0, 0)); sp.paste(b, (a.width, 0))
        dr = ImageDraw.Draw(sp)
        for k in range(40):
            shade = int(60 + k * 4)
            dr.line([(a.width - 20 + k, 0), (a.width - 20 + k, a.height)], fill=min(shade, 235) if k < 20 else min(60 + (40 - k) * 4, 235))
        spreads.append(sp)
    spreads[0].save(os.path.join(OUT, 'scanned-spreads.pdf'), save_all=True, append_images=spreads[1:], resolution=200)

if __name__ == '__main__':
    p = os.path.join(OUT, 'two-column-paper.pdf')
    build_paper(p)
    build_scans(p)
    print('ok')
