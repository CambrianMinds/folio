# Scenario verification

Run `npm run test:scenarios` after preparing the Windows binaries and building `folio-render`. This suite uses synthetic documents. Its PDFs, page images, source files, layouts and diagnostics go under ignored `verification/scenarios/`. The JSON report records each expected result and each assertion failure. A failed case makes the command fail.

| Area | Scenarios and assertions |
| --- | --- |
| Input | Empty text, whitespace, UTF-8 BOM, CRLF, accents, combining characters, Greek and arrows. Unsupported control characters produce a specific error. |
| Structure | Six heading levels, nested lists, definitions, quotes, rules, tables, footnotes, outlines and explicit page/column breaks. Required content survives export. |
| Code | Long lines, long tokens, tabs, indentation, blank lines, literal backticks, incomplete fences, Unicode, list and quote containers, inline code, multi-page blocks and a large token. Exported characters and order are checked. |
| Math | Dollar and backslash delimiters, fractions, matrices, aligned equations, nested and wide equations, literal delimiters in code and unmatched delimiters. Unsupported commands remain literal with a visible warning. File commands are never executed. |
| Wrapping | Long filenames, bold identifiers, inline code, table labels and web-link labels stay inside their available column. |
| Geometry | One through six columns, Letter/A4/A5, landscape, mirrored margins, tight/large spacing, four typefaces and justification. PDF text bounds, gutter crossings and pagination are checked. |
| Metadata | Literal code-shaped titles, headers and footers. Text that fits a larger margin must survive. Text that cannot fit must produce a specific error. |
| Assets | PNG, SVG vectors, spaces, Unicode and percent-encoded filenames. Missing, remote, data URI, outside-folder and unsupported files fail without producing output. |
| Invalid layouts | Unsupported schemas, unknown fields, impossible dimensions/gutters, invalid colors, oversized ASCII/UTF-8 fields and control characters. |

The suite opens each successful PDF independently with PyMuPDF and checks it with bundled qpdf. Content checks exclude page folios, normalize discretionary hyphens, and retain code characters. Geometry checks allow four points of glyph/punctuation overhang. The first page of each successful case is rendered for visual review. These assertions accompany visual review, since compilation alone cannot establish the quality of every layout.

Additional layers run with the project tests.

| Command | Coverage |
| --- | --- |
| `npm test` | Config/template validation, the native UTF-8 field limits, selections, ranges and logical page operations. Five hundred deterministic mixed edits check identity, immutability and undo/redo round trips. |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Publishing regression and bundled qpdf operations, corruption, encryption/permissions, invalid page references, unavailable/changed sources, mixed dimensions, vectors, extraction, splitting and independent rotations of duplicated pages with existing source rotation. |
| `npm run test:organizer` | Real packaged Windows app, native pickers, keyboard operations, previews, independent previews of differently sized source documents, distinct thumbnails for revisions sharing a PDF ID, 509-page virtualization/export, scrolling during imports, group reordering, queued native drops, drag cancellation and Compose transfer. Thumbnail images are compared with exported pages. |
| `npm run test:ui` | Existing Compose native UI checks through a running test WebView on port 9223. |

`scripts/build-windows.ps1` runs the synthetic publishing scenarios during verified packaging. Native desktop tests require an interactive Windows session. Keep any private corpus, derived PDFs and private reports outside this repository and its packaging directories.
