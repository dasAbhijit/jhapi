import io, sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
out = sys.argv[1]
# Made-up statement. Each line is a list of (x, text) pieces, like a PDF table.
lines = [
 [(40,"Consolidated Account Statement")],
 [(40,"01-Jan-2020 To 25-Nov-2026")],
 [(40,"Example Mutual Fund")],
 [(40,"Folio No: 1234567 / 89"),(250,"PAN: ABCDE1234F")],
 [(40,"X123-Example Flexi Cap Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF000A01AB1"),(470,"Registrar : CAMS")],
 [(40,"Closing Unit Balance: 150.000"),(190,"NAV on 25-Nov-2026: INR 102.3456"),(370,"Total Cost Value: 14,500.00")],
 [(40,"Market Value on 25-Nov-2026: INR 15,351.84")],
]
buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=A4)
c.setFont("Helvetica", 7)
y = 800
for pieces in lines:
    for x, t in pieces: c.drawString(x, y, t)
    y -= 14
c.showPage()
c.setFont("Helvetica", 7)
c.drawString(40, 800, "Page 2 of 2")
c.save()
w = PdfWriter(clone_from=PdfReader(io.BytesIO(buf.getvalue())))
w.encrypt(user_password="ABCDE1234F", owner_password="owner-made-up", algorithm="AES-256")
with open(out, "wb") as f: w.write(f)
