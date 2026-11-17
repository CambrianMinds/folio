"""Public, synthetic publishing scenarios. Private corpora stay outside this repo.

Requires PyMuPDF and Pillow. Every scenario records its expected behavior, checks
PDF geometry/content, and leaves the source, layout, PDF and diagnostics to inspect.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import time
import unicodedata
import sys

import pymupdf as fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification/scenarios'
BIN = ROOT / 'src-tauri/resources/bin'
READER = 'markdown+raw_attribute+tex_math_dollars+tex_math_single_backslash'


@dataclass
class Scenario:
    name: str
    category: str
    source: str
    config: dict = field(default_factory=dict)
    error: str = ''
    required: tuple = ()
    forbidden: tuple = ()
    code: str = ''
    warning: str = ''
    minimum_pages: int = 1
    images: bool = False
    links: bool = False
    page_text: tuple = ()
    vector: bool = False


def compact(value):
    value = unicodedata.normalize('NFKC', value).replace('\u00ad', '')
    return re.sub(r'\s+', '', value)


def command(arguments, **kwargs):
    return subprocess.run([str(arg) for arg in arguments], capture_output=True,
                          text=True, encoding='utf-8', errors='replace', timeout=100, **kwargs)


def fenced(value, language='text'):
    return f'````{language}\n{value}\n````\n'


def scenarios():
    paragraph = ('A careful test preserves every part of the argument. '
                 'Margins, type, links and page breaks should remain consistent. ')
    long_token = 'IDENTIFIER_' + 'abcdefgh0123456789' * 24 + '_COMPLETE'
    path = 'folder_' * 14 + 'record_2026-11-17.final.md'
    core = [
        Scenario('empty', 'source', ''),
        Scenario('whitespace', 'source', '\n\t\n  \n'),
        Scenario('unicode', 'text', '# Unicode\n\nCafé naïve Καλημέρα → ← ± résumé.\n', required=('Café', 'Καλημέρα', 'résumé')),
        Scenario('combining', 'text', 'Combining cafe\u0301 and nai\u0308ve.\n', required=('café', 'naïve')),
        Scenario('crlf', 'source', '# Windows\r\n\r\nCRLF_MARKER survives.\r\n', required=('CRLF_MARKER',)),
        Scenario('bom', 'source', '\ufeff# Encoding\n\nBOM_MARKER survives.\n', required=('BOM_MARKER',)),
        Scenario('headings', 'structure', '\n\n'.join('#' * level + f' Heading level {level}\n\n' + paragraph for level in range(1, 7)), required=('Heading level 6',)),
        Scenario('nested-lists', 'structure', '1. First entry\n   - Nested entry\n     - Deeper entry\n2. Final entry\n', required=('Deeper entry', 'Final entry')),
        Scenario('quotes', 'structure', '> A quoted paragraph.\n>\n> > A nested quote.\n\nAFTER_QUOTE\n', required=('nested quote', 'AFTER_QUOTE')),
        Scenario('definitions', 'structure', 'Term one\n: Meaning one.\n\nTerm two\n: Meaning two.\n', required=('Meaning two',)),
        Scenario('separators', 'structure', 'Before rule.\n\n---\n\nAfter first.\n\n***\n\nAfter second.\n\n___\n\nRULE_END\n', required=('Before rule', 'RULE_END')),
        Scenario('long-prose-token', 'wrapping', f'Before **{path}** after.\n\n{long_token}\n', required=(path, long_token)),
        Scenario('long-link-label', 'wrapping', f'[{path}](https://example.org/folio)\n', required=(path,), links=True),
        Scenario('inline-code', 'code', f'Before `{long_token}` after.\n', code=long_token),
        Scenario('code-spaces', 'code', fenced('begin ' + ('value = argument + next_argument; ' * 14) + ' END_CODE'), code='begin ' + ('value = argument + next_argument; ' * 14) + ' END_CODE'),
        Scenario('code-token', 'code', fenced(long_token), code=long_token),
        Scenario('code-tabs', 'code', fenced('def operation():\n\tif ready:\n\t\tresult = "\u03bb"\n\treturn result', 'python'), required=('def', 'operation', 'return', 'result')),
        Scenario('code-blank-lines', 'code', fenced('BEFORE_BLANK\n\n\nAFTER_BLANK'), required=('BEFORE_BLANK', 'AFTER_BLANK')),
        Scenario('code-unicode', 'code', fenced('café = "Καλημέρα → résultat"\ncombine = "cafe\u0301"', 'python'), required=('café', 'Καλημέρα', 'résultat')),
        Scenario('code-literal-typst', 'security', fenced('#read("SHOULD_NEVER_BE_OPENED.txt")\n#import "@preview/example:1.0.0"\n<svg onload="bad()">', 'typst'), required=('SHOULD_NEVER_BE_OPENED.txt',)),
        Scenario('code-backticks', 'code', fenced('literal ``` backticks and `inline` markers'), code='literal ``` backticks and `inline` markers'),
        Scenario('code-unclosed', 'code', '```python\nUNTERMINATED_FENCE_END\n', required=('UNTERMINATED_FENCE_END',)),
        Scenario('code-in-list', 'code', '1. Nested code\n\n' + '\n'.join('   ' + line for line in fenced(long_token).splitlines()) + '\n\n2. LIST_END\n', code=long_token, required=('LIST_END',)),
        Scenario('code-in-quote', 'code', '\n'.join('> ' + line for line in fenced(long_token).splitlines()) + '\n\nQUOTE_END\n', code=long_token, required=('QUOTE_END',)),
        Scenario('code-pagination', 'pagination', fenced('\n'.join(f'RECORD_{index:03d} payload_{index:03d}_COMPLETE' for index in range(260))), required=tuple(f'RECORD_{index:03d}' for index in range(260)), minimum_pages=2),
        Scenario('code-large-token', 'performance', fenced('START_' + 'ab1234' * 1200 + '_END'), code='START_' + 'ab1234' * 1200 + '_END'),
        Scenario('math-dollar', 'math', 'Inline $x^2 + y^2 = z^2$.\n\n$$\n\\frac{a+b}{c} = \\sqrt{d}\n$$\n\nMATH_END\n', required=('MATH_END',)),
        Scenario('math-backslash', 'math', r'Inline \(x^2 + y^2 = z^2\).' + '\n\n' + r'\[\frac{a+b}{c} = \sqrt{d}\]' + '\n\nMATH_END\n', required=('MATH_END',)),
        Scenario('math-matrix', 'math', r'\[\begin{pmatrix} a & b \\ c & d \end{pmatrix}\]' + '\n\nMATRIX_END\n', required=('MATRIX_END',)),
        Scenario('math-aligned', 'math', r'\[\begin{aligned} f(x)&=x^2+1 \\ g(x)&=\frac{x}{2}\end{aligned}\]' + '\n\nALIGNED_END\n', required=('ALIGNED_END',)),
        Scenario('math-wide', 'math', r'\[\boxed{\text{A deliberately long mathematical statement remains complete when the available column is narrow.}}\]' + '\n\nWIDE_END\n', required=('deliberately', 'narrow', 'WIDE_END')),
        Scenario('math-nested', 'math', '> Quoted equation\n>\n> ' + r'\[\frac{a}{b}+\sum_{i=1}^{n}i\]' + '\n\nNESTED_MATH_END\n', required=('NESTED_MATH_END',)),
        Scenario('math-code-literal', 'math', fenced(r'\(literal_parentheses\) and \[literal_brackets\]') + '\nLiteral code above.\n', code=r'\(literal_parentheses\) and \[literal_brackets\]'),
        Scenario('math-unsupported', 'math', r'$\unknowncommand{x}$' + '\n\nUNSUPPORTED_MATH_END\n', required=('unknowncommand', 'UNSUPPORTED_MATH_END'), warning='shown as literal TeX'),
        Scenario('math-file-command', 'security', r'$\input{DO_NOT_READ.txt}$' + '\n\nSAFE_MATH_END\n', required=('DO_NOT_READ.txt',), warning='shown as literal TeX'),
        Scenario('math-unterminated', 'math', r'An unmatched \( delimiter and dollar $ remain text.' + '\n', required=('unmatched', 'remain text')),
        Scenario('table', 'structure', '| Name | Value | Notes |\n|---|---:|---|\n| First | 12 | Normal entry |\n| Second | 24 | Final entry |\n', required=('Final entry',)),
        Scenario('table-long-label', 'wrapping', f'| Identifier | Value |\n|---|---|\n| {long_token} | TABLE_END |\n', required=('TABLE_END', long_token)),
        Scenario('footnotes-links', 'structure', 'A footnote[^first] and [a web link](https://example.org/folio).\n\n[^first]: FOOTNOTE_END remains visible.\n', required=('FOOTNOTE_END',), links=True),
        Scenario('metadata', 'metadata', '---\ntitle: "Title with #read(quoted), brackets [x], and café"\nauthor: "Author A"\n---\n\nMETADATA_END\n', required=('Title with', 'METADATA_END')),
        Scenario('title-clearance', 'pagination', '---\ntitle: "A full-width title across the columns"\n---\n\n## First section\n\n' + paragraph * 16, required=('full-width title', 'First section')),
        Scenario('pagebreak', 'pagination', 'PAGE_ONE\n\n<!-- folio:pagebreak -->\n\nPAGE_TWO\n', required=('PAGE_ONE', 'PAGE_TWO'), minimum_pages=2),
        Scenario('columnbreak', 'pagination', 'COLUMN_ONE\n\n<!-- folio:columnbreak -->\n\nCOLUMN_TWO\n', required=('COLUMN_ONE', 'COLUMN_TWO')),
        Scenario('outline', 'structure', '<!-- folio:toc -->\n\n# First section\n\nBody.\n\n## Second section\n\nOUTLINE_END\n', required=('OUTLINE_END',)),
        Scenario('raw-typst', 'security', '```{=typst}\n#read("PRIVATE_MARKER.txt")\n```\n\nSAFE_RAW_END\n', required=('SAFE_RAW_END',), forbidden=('PRIVATE_MARKER',), warning='omitted'),
        Scenario('raw-html', 'security', '<script>HIDDEN_SCRIPT_MARKER</script>\n\nSAFE_HTML_END\n', required=('SAFE_HTML_END',), forbidden=('HIDDEN_SCRIPT_MARKER',), warning='omitted'),
        Scenario('image-local', 'assets', '![A local figure](figure.png)\n\nIMAGE_END\n', required=('IMAGE_END',), images=True),
        Scenario('image-unicode', 'assets', '![Unicode figure](<figure café λ.png>)\n\nUNICODE_IMAGE_END\n', required=('UNICODE_IMAGE_END',), images=True),
        Scenario('image-percent', 'assets', '![Encoded figure](figure%20caf%C3%A9%20%CE%BB.png)\n\nENCODED_IMAGE_END\n', required=('ENCODED_IMAGE_END',), images=True),
        Scenario('image-svg', 'assets', '![Vector figure](figure.svg)\n\nSVG_IMAGE_END\n', required=('SVG_IMAGE_END',), vector=True),
    ]
    cases = []
    layouts = {'one': {'columns': 1}, 'two': {'columns': 2, 'rule': True},
               'three': {'columns': 3, 'fontSize': 9, 'codeSize': 7, 'rule': True}}
    for scenario in core:
        for name, patch in layouts.items():
            cases.append(Scenario(**{**scenario.__dict__, 'name': f'{scenario.name}-{name}',
                                    'config': {**scenario.config, **patch}}))
    geometry_source = '# Layout specimen\n\n' + paragraph * 35 + '\n\n' + fenced('GEOMETRY_CODE_START ' + 'argument ' * 18 + 'GEOMETRY_CODE_END')
    for columns in range(1, 7):
        for paper, width, height, landscape in [('Letter', 612, 792, False), ('A4', 595.276, 841.89, False), ('Letter', 612, 792, True)]:
            patch = {'paper': paper, 'width': width, 'height': height, 'columns': columns,
                     'landscape': landscape, 'fontSize': 7 if columns >= 4 else 9,
                     'codeSize': 6 if columns >= 4 else 8, 'marginLeft': 30, 'marginRight': 30,
                     'gutter': 12, 'rule': columns > 1}
            cases.append(Scenario(f'geometry-{paper}-{columns}-{landscape}', 'geometry', geometry_source,
                                  patch, required=('GEOMETRY_CODE_END',)))
    for font in ['Georgia', 'Palatino Linotype', 'Segoe UI', 'Times New Roman']:
        for justify in [False, True]:
            cases.append(Scenario(f'font-{font.replace(" ", "-")}-{justify}', 'typography',
                                  '# Typography\n\n' + paragraph * 20 + f'\n\n**{path}**\n',
                                  {'bodyFont': font, 'headingFont': font, 'columns': 2, 'justify': justify}, required=(path,)))
    for patch, name in [({'mirrored': True, 'marginLeft': 72, 'marginRight': 42}, 'mirrored'),
                        ({'paper': 'A5', 'width': 419.528, 'height': 595.276}, 'a5'),
                        ({'leading': .1, 'paragraphSpacing': 0, 'fontSize': 8}, 'tight'),
                        ({'leading': 1.2, 'paragraphSpacing': 14, 'fontSize': 16}, 'large')]:
        cases.append(Scenario(f'layout-{name}', 'geometry', geometry_source, patch, required=('GEOMETRY_CODE_END',)))
    for name, patch, error in [
        ('columns', {'columns': 7}, 'between 1 and 6'),
        ('narrow', {'columns': 6, 'marginLeft': 150}, 'too narrow'),
        ('height', {'marginTop': 360, 'marginBottom': 360}, 'too little space'),
        ('gutter', {'columns': 2, 'rule': True, 'gutter': 1}, 'gutter'),
        ('color', {'textColor': 'red'}, 'Colors'),
        ('future', {'schemaVersion': 2}, 'newer Folio'),
        ('unknown', {'unknownField': True}, 'unknown field'),
        ('oversize-text', {'header': 'h' * 2049}, 'too long'),
        ('oversize-utf8', {'title': 'é' * 1025}, 'too long'),
        ('control-text', {'header': 'before\x00after'}, 'unsupported control character'),
    ]:
        cases.append(Scenario(f'invalid-{name}', 'validation', 'VALID_SOURCE', patch, error=error))
    cases.extend([
        Scenario('header-literal', 'metadata', 'BODY_MARKER\n', {'header': '#read("LITERAL_HEADER.txt")'}, required=('BODY_MARKER',), page_text=('LITERAL_HEADER.txt',)),
        Scenario('footer-literal', 'metadata', 'BODY_MARKER\n', {'footer': '#read("LITERAL_FOOTER.txt")'}, required=('BODY_MARKER',), page_text=('LITERAL_FOOTER.txt',)),
        Scenario('header-long', 'metadata', 'BODY_MARKER\n', {'header': 'HEADER_START ' + 'headerword ' * 100 + 'HEADER_END'}, error='Header does not fit'),
        Scenario('footer-long', 'metadata', 'BODY_MARKER\n', {'footer': 'FOOTER_START ' + 'footerword ' * 100 + 'FOOTER_END'}, error='Footer does not fit'),
        Scenario('header-large-margin', 'metadata', 'BODY_MARKER\n', {'header': 'HEADER_START ' + 'headerword ' * 100 + 'HEADER_END', 'marginTop': 150}, required=('BODY_MARKER',), page_text=('HEADER_START', 'HEADER_END')),
        Scenario('footer-large-margin', 'metadata', 'BODY_MARKER\n', {'footer': 'FOOTER_START ' + 'footerword ' * 100 + 'FOOTER_END', 'marginBottom': 200}, required=('BODY_MARKER',), page_text=('FOOTER_START', 'FOOTER_END')),
    ])
    for name, source, error in [
        ('nul', 'Before\x00After', 'control character U+0000'),
        ('escape', 'Before\n\x1b[31mAfter', 'control character U+001B'),
        ('remote-image', '![Remote](https://example.org/no.png)', 'Remote images'),
        ('data-image', '![Data](data:image/png;base64,AAAA)', 'Remote images'),
        ('missing-image', '![Missing](absent.png)', 'Image not found'),
        ('outside-image', '![Outside](../outside.png)', 'inside the document folder'),
        ('wrong-image-format', '![Wrong](fake.pdf)', 'Unsupported image type'),
    ]:
        cases.append(Scenario(name, 'validation', source, error=error))
    return cases


def run_case(scenario, cli):
    started = time.monotonic()
    # A prefix also keeps scenario IDs such as "nul" clear of Windows device names.
    folder = OUT / f'case-{scenario.name}'
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / 'source.md'
    source.write_text(scenario.source, encoding='utf-8', newline='')
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    layout = folder / 'layout.json'
    layout.write_text(json.dumps(scenario.config, indent=2), encoding='utf-8')
    Image.new('RGB', (80, 30), '#304a57').save(folder / 'figure.png')
    Image.new('RGB', (80, 30), '#304a57').save(folder / 'figure café λ.png')
    (folder / 'fake.pdf').write_bytes(b'fake image extension')
    (folder / 'figure.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect x="2" y="2" width="156" height="56" fill="#eeede8" stroke="#304a57"/></svg>', encoding='utf-8')
    pdf = folder / 'document.pdf'
    # A failed retry must not be mistaken for an earlier successful output.
    if pdf.exists():
        pdf.unlink()
    result = command([cli, source, pdf, layout])
    (folder / 'diagnostic.txt').write_text(result.stderr, encoding='utf-8')
    row = {'scenario': scenario.name, 'folder': folder.name, 'category': scenario.category, 'passed': False,
           'expected': 'error' if scenario.error else 'PDF', 'diagnostic': result.stderr.strip()}
    try:
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before, 'Source was modified'
        if scenario.error:
            assert result.returncode != 0, 'Expected a specific validation error'
            assert scenario.error.lower() in result.stderr.lower(), f'Wrong error: {result.stderr}'
            assert not pdf.exists(), 'Failed render left a destination PDF'
        else:
            assert result.returncode == 0, result.stderr
            if scenario.warning:
                assert scenario.warning in result.stderr, 'Expected a visible diagnostic'
            check = command([BIN / 'qpdf/qpdf.exe', pdf, '--check'])
            assert check.returncode == 0, check.stderr
            document = fitz.open(pdf)
            # Page folios belong to the page, and must not interrupt source-content checks.
            bottom = scenario.config.get('marginBottom', 54)
            text = ''.join(page.get_text(clip=fitz.Rect(0, 0, page.rect.width, page.rect.height - bottom + 4)) for page in document)
            normalized = compact(text)
            complete = compact(''.join(page.get_text() for page in document))
            for expected in scenario.page_text:
                assert compact(expected) in complete, f'Header or footer text was clipped: {expected}'
            assert '\x00' not in text and '\ufffd' not in text, 'Missing glyph in PDF text'
            assert len(document) >= scenario.minimum_pages, 'Incorrect pagination'
            for expected in scenario.required:
                assert compact(expected) in normalized, f'Missing text: {expected[:80]}'
            for forbidden in scenario.forbidden:
                assert forbidden not in text, f'Unsafe raw content was published: {forbidden}'
            if scenario.code:
                assert compact(scenario.code) in normalized, 'Code characters were lost or reordered'
            if scenario.images:
                assert any(page.get_images() for page in document), 'Embedded image was lost'
            if scenario.links:
                assert any(page.get_links() for page in document), 'Web link was lost'
            if scenario.vector:
                assert any(page.get_drawings() for page in document), 'Vector figure was lost'
            outside = []
            gutter = []
            for index, page in enumerate(document):
                left = scenario.config.get('marginLeft', 58)
                right = scenario.config.get('marginRight', 58)
                if scenario.config.get('mirrored') and index % 2:
                    left, right = right, left
                columns = scenario.config.get('columns', 1)
                gap = scenario.config.get('gutter', 18)
                width = (page.rect.width - left - right - (columns - 1) * gap) / columns
                for word in page.get_text('words'):
                    if word[0] < left - 4 or word[2] > page.rect.width - right + 4 or word[1] < -1 or word[3] > page.rect.height + 1:
                        outside.append(index + 1)
                    for column in range(1, columns):
                        x = left + column * width + (column - .5) * gap
                        if word[0] < x - 1 and word[2] > x + 1:
                            # Full-width metadata titles deliberately span the columns.
                            if not scenario.name.startswith('title-clearance') and not scenario.name.startswith('metadata'):
                                gutter.append(index + 1)
            assert not outside, f'Text outside side margins or page: {sorted(set(outside))}'
            assert not gutter, f'Text crosses a column gutter: {sorted(set(gutter))}'
            row.update(pages=len(document), textCharacters=len(text))
            document[0].get_pixmap(matrix=fitz.Matrix(.8, .8)).save(folder / 'page-1.png')
            document.close()
        row['passed'] = True
    except AssertionError as error:
        row['failure'] = str(error)
    row['seconds'] = round(time.monotonic() - started, 3)
    return row


def main():
    sys.stdout.reconfigure(errors='backslashreplace')
    parser = argparse.ArgumentParser()
    parser.add_argument('--cli', type=Path, default=ROOT / 'src-tauri/target/debug/folio-render.exe')
    parser.add_argument('--filter', default='')
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (8, 8), 'white').save(OUT / 'outside.png')
    cases = [case for case in scenarios() if args.filter in case.name]
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = {pool.submit(run_case, case, args.cli): case for case in cases}
        for task in as_completed(tasks):
            try:
                row = task.result()
            except Exception as error:
                case = tasks[task]
                row = {'scenario': case.name, 'folder': f'case-{case.name}', 'category': case.category,
                       'passed': False, 'expected': 'error' if case.error else 'PDF',
                       'failure': f'{type(error).__name__}: {error}', 'diagnostic': str(error)}
            rows.append(row)
            print(f'{len(rows)}/{len(cases)} {"PASS" if row["passed"] else "FAIL"} {row["scenario"]}' + (f' — {row["failure"][:140]}' if not row['passed'] else ''), flush=True)
    rows.sort(key=lambda row: row['scenario'])
    report = {'cases': len(rows), 'passed': sum(row['passed'] for row in rows), 'results': rows}
    name = 'report' if not args.filter else 'report-' + re.sub(r'[^a-zA-Z0-9-]', '-', args.filter)
    (OUT / f'{name}.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    index = ['# Publishing scenario results', '', f'{report["passed"]} / {report["cases"]} passed.', '', '| Scenario | Category | Result | Evidence |', '| --- | --- | --- | --- |']
    for row in rows:
        case = row['scenario']
        target = f'{row["folder"]}/document.pdf' if row['expected'] == 'PDF' and row['passed'] else f'{row["folder"]}/diagnostic.txt'
        index.append(f'| {case} | {row["category"]} | {"Passed" if row["passed"] else "Failed"} | [Open](<{target}>) |')
    (OUT / f'{name}.md').write_text('\n'.join(index), encoding='utf-8')
    print(json.dumps({'cases': report['cases'], 'passed': report['passed'], 'failed': report['cases'] - report['passed']}), flush=True)
    raise SystemExit(0 if all(row['passed'] for row in rows) else 1)


if __name__ == '__main__':
    main()
