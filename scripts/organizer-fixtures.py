"""PDF fixtures and independent inspection for the packaged organizer tests."""
from pathlib import Path
import hashlib
import json
import sys
import pymupdf as fitz
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification' / 'organizer'
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(612, 792), (595, 842), (792, 612), (420, 595), (595, 420)]


def fixtures():
    for name, count, prefix in [('Report with spaces.pdf', 3, 'A'), ('Appendix \u03bb.pdf', 2, 'B'), ('Large.pdf', 500, 'L')]:
        document = fitz.open()
        for index in range(count):
            width, height = SIZES[index % len(SIZES)]
            page = document.new_page(width=width, height=height)
            page.insert_text((45, 65), f'{prefix}{index + 1}', fontsize=32)
            page.draw_rect(fitz.Rect(40, 100, 150, 180), color=(.2, .35, .45), width=2)
            page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(40, 40, 140, 90), 'uri': 'https://example.org'})
        document.save(OUT / name)
        document.close()
    (OUT / 'Corrupt.pdf').write_bytes(b'This is not a PDF.')
    hashes = {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in ['Report with spaces.pdf', 'Appendix \u03bb.pdf']}
    (OUT / 'source-hashes.json').write_text(json.dumps(hashes), encoding='utf-8')


def check():
    document = fitz.open(OUT / 'organized.pdf')
    expected = ['A2', 'B1', 'A2', 'B1', 'A1', 'A3', 'B2']
    angles = [90, 90, 270, 270, 0, 0, 0]
    assert len(document) == len(expected)
    image_errors = []
    for index, (page, label, angle) in enumerate(zip(document, expected, angles)):
        assert page.get_text().strip() == label, (index, page.get_text())
        assert page.rotation == angle, (index, page.rotation)
        assert page.get_drawings(), f'Page {index + 1} lost its vectors'
        assert not page.get_images(), f'Page {index + 1} was rasterized'
        assert page.get_links()[0]['uri'] == 'https://example.org'
        source_name = 'Report with spaces.pdf' if label.startswith('A') else 'Appendix \u03bb.pdf'
        source = fitz.open(OUT / source_name)
        assert page.mediabox == source[int(label[1:]) - 1].mediabox
        source.close()
        image = Image.open(OUT / f'thumbnail-{index + 1}.png').convert('RGB')
        scale = min(280 / page.rect.width, 360 / page.rect.height)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        reference = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
        reference = reference.resize(image.size)
        difference = sum(ImageStat.Stat(ImageChops.difference(image, reference)).mean) / 3
        assert difference < 8, (index, difference)
        image_errors.append(round(difference, 3))
        if index == 0:
            page.get_pixmap().save(OUT / 'exported-page-1.png')
    document.close()
    extracted = fitz.open(OUT / 'extracted.pdf')
    assert [p.get_text().strip() for p in extracted] == ['A1', 'A3', 'B2']
    extracted.close()
    batches = sorted(OUT.glob('Folio-split-*'))
    assert len(batches) >= 2
    counts = []
    for batch in batches:
        parts = sorted(batch.glob('Part-*.pdf'))
        text = []
        lengths = []
        for part in parts:
            pdf = fitz.open(part)
            lengths.append(len(pdf))
            text.extend(p.get_text().strip() for p in pdf)
            pdf.close()
        assert text == expected, text
        counts.append(lengths)
    assert [2, 2, 3] in counts, counts
    assert [1] * 7 in counts, counts
    composed = fitz.open(OUT / 'with-compose.pdf')
    assert len(composed) == 9
    assert 'shape of a page' in composed[7].get_text().lower()
    composed.close()
    large = fitz.open(OUT / 'large-organized.pdf')
    assert len(large) == 509
    assert large[-1].get_text().strip() == 'L500'
    assert large[-1].get_drawings()
    large.close()
    for name, digest in json.loads((OUT / 'source-hashes.json').read_text()).items():
        assert hashlib.sha256((OUT / name).read_bytes()).hexdigest() == digest
    (OUT / 'pdf-report.json').write_text(json.dumps({'pages': expected, 'rotations': angles, 'thumbnail_pixel_mean_errors': image_errors, 'split_counts': counts, 'compose_pages': 9, 'vectors_preserved': True, 'links_preserved': True, 'source_hashes_unchanged': True}, indent=2), encoding='utf-8')
    print('Organizer PDF content, vectors, links, sizes, rotations and thumbnail comparisons passed.')


if sys.argv[1] == 'fixtures':
    fixtures()
else:
    check()
