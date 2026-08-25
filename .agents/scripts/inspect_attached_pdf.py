from pathlib import Path
import fitz

output_dir = Path(".agents/outputs/attached-pdf-inspection")
output_dir.mkdir(parents=True, exist_ok=True)

for pdf_path in sorted(Path("attached_assets").glob("*.pdf")):
    document = fitz.open(pdf_path)
    print(f"{pdf_path.name}: pages={document.page_count}, metadata={document.metadata}")
    text = "\n".join(page.get_text() for page in document)
    print(text[:5000])
    print("---")
    for page_number in range(min(document.page_count, 3)):
        pixmap = document[page_number].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        image_path = output_dir / f"{pdf_path.stem}-page-{page_number + 1}.png"
        pixmap.save(image_path)
        print(f"rendered={image_path}")