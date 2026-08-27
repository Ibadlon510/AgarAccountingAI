import fitz
from pathlib import Path
source = Path('attached_assets/3_EUR_AccountStatement_01-10-24_to_30-09-25_1787652849039.pdf')
out = Path('.agents/outputs/mashreq-statement-page-1.png')
doc = fitz.open(source)
page = doc[0]
pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
pix.save(out)
print({'pages': doc.page_count, 'page_size': [page.rect.width, page.rect.height], 'output': str(out)})
