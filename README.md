# Folio

A Windows desktop instrument for composing Markdown into printed pages. Tauri 2, React, CodeMirror 6, Pandoc, Typst, and PDF.js. Publishing runs entirely on your computer.

## Composition tools (0.2)

**Describe a change…** opens the composition tools; **Ctrl Shift L** focuses the command field. Explicit requests such as “Two columns, half-inch margins, Georgia 11 point, and a thin gray rule” are parsed locally without a model. Inspect the proposed changes, then apply them as one undoable operation. Unsupported clauses and invalid geometry are rejected rather than silently ignored. **Ctrl Alt Z / Ctrl Alt Y** undo/redo layout changes independently of editor undo.

Save named **variations** for each document. **Compare** shows a captured PDF beside the current PDF; **Capture current as before** updates the reference. Comparisons clear when source text changes, so both compositions use the same writing. **Guides** overlays nonprinting margins and column boundaries. **Checks** reviews text outside side margins, unavailable selected fonts, possible page-ending headings, and sparse final pages. These checks are review aids, not proof of flawless pagination. All working panes scroll independently, including both comparison previews and the expanded tools panel.

**Find a fit** compiles actual PDFs while exploring bounded body size and spacing. Paper, columns, margins and typefaces remain fixed. It reports a tested candidate meeting the page target, or reports that none of its tested candidates succeeded. It never claims exhaustive optimization. Source or layout changes cancel an obsolete search. No fitting changes are applied until reviewed.

### External-model JSON templates

Expand **External model templates**. **Copy LLM instructions** copies a self-contained prompt with the JSON schema, current settings, available fonts, and an example. It does not copy Markdown content. Give that prompt and your layout requirements to an external model of your choice. Paste its JSON with **Paste JSON** or **Open JSON…**, then **Review changes**. Folio validates the schema and geometry before offering **Apply changes**.

**Save template** stores a reusable named partial template in preferences; **Export JSON…** saves it as a normal file. Omitted settings are preserved exactly. The original Markdown is never rewritten by a template. A returned `clarification` question prevents application. Saved templates can be loaded, inspected, exported or deleted.

Standalone exchange artifacts are in `templates/folio-layout-template.json`, `templates/folio-layout-template.schema.json` and `templates/LLM-INSTRUCTIONS.md`. The build regenerates them from the same typed schema used by the application. Document variations store complete layouts; reusable external templates store only the changes requested.

### CPU language processing

The deterministic command parser handles individual settings and measurements. An optional llama.cpp CPU runtime interprets broad publishing-style descriptions into one of four defined presets. Models cannot calculate margins or propose arbitrary field changes. Unknown numerical wording, unclear purposes and conflicting style signals request clarification. The style suggestion is still reviewed before application.

`scripts/prepare-model.ps1` prepares the tested Qwen3-4B-Instruct-2507 Q4_K_M model (~2.5 GB), with a pinned revision and SHA-256 checksum. The CPU runtime is included in the application, while model weights are stored separately under `%LOCALAPPDATA%\Folio\models`. Choose this model in the tools and enable **Interpret style descriptions locally**. No GPU, local server, Python installation, account or network connection is needed for inference. Four CPU threads are used. A style request took roughly 8–12 seconds on the development machine; exact commands are processed directly.

The earlier 0.6B numerical translator was rejected. Model arithmetic and unrestricted layout patches are not part of the shipped local-model workflow. `scripts/benchmark-styles.py` checks guarded style selection; the frontend test suite separately checks exact commands, preserved values, templates, history and invalid/ambiguous input. Passing this finite suite is not a guarantee for arbitrary natural language.

## Use

Install the NSIS setup executable, or extract the portable ZIP and run `folio.exe`. The portable folder must retain its `resources` directory. The installer includes an offline WebView2 runtime installer; portable use requires Microsoft Edge WebView2 already installed.

Open a UTF-8 `.md` or `.markdown` document, choose a preset, and adjust the inspector. The center displays the actual compiled PDF. Export copies the exact successful preview bytes; it never runs a different typesetter. Publishing remains disabled while the current source/layout has no successful preview.

- **Ctrl O** open; **Ctrl S** save; **Ctrl Shift S** save as.
- **Ctrl E** export PDF; **Ctrl P** open the current PDF in your PDF reader for printing.
- **Ctrl F** find; **Ctrl H** replace; **Ctrl Z / Ctrl Y** undo/redo in the editor.
- Drag a Markdown file onto the window to open it.
- Drag the pane dividers or focus them and use the arrow keys to resize.
- Hide the editor or inspector from the toolbar. On narrower windows the inspector collapses; showing it hides the editor to make room.

Saving writes an adjacent `document.folio.json` beside `document.md`. Geometry is stored in points; inspector units only affect presentation. Formatting-only saves do not rewrite Markdown. Folio detects external source changes and asks you to use Save As or reload instead of overwriting them. Open and close protect unsaved source **and layout** changes. Recent documents, panel geometry, and personal presets live under `%APPDATA%\local.folio.publisher\preferences.json`.

YAML `title` and `author` supply the document title and PDF metadata. Inspector overrides are optional. Full-width titles span page columns; separators begin below the title. Mirrored margins use inside/outside geometry on alternating pages. Installed fonts are enumerated; Typst's embedded Libertinus Serif provides a final fallback.

### Layout directives

Use these exact standalone comments, separated from surrounding paragraphs by blank lines:

```markdown
<!-- folio:pagebreak -->

<!-- folio:columnbreak -->

<!-- folio:toc -->
```

Use the Insert menu to add them. Ordinary Markdown, tables, fenced code, nested lists, images, footnotes, and dollar-delimited math pass through Pandoc. Raw HTML/LaTeX/Typst and arbitrary includes are intentionally omitted. The layout language is limited to the three directives above.

Images must be in the Markdown document's folder or a subfolder. Spaces, Unicode names and percent-encoded image references are supported. Network images and paths outside that folder are rejected. Hyperlinks survive PDF export and can open your browser when clicked in the preview. The publishing pipeline itself never fetches URLs or Typst packages.

The advanced Typst export writes the complete generated source and an adjacent folder containing the snapshotted images. Printing opens a temporary PDF with the system's PDF application; choose Print there. No job is sent to a printer automatically.

## Build on Windows x64

Development prerequisites: Node 24.11.1 or newer supported Node, Rust 1.96.0 MSVC, Visual Studio 2022 C++ Build Tools, Windows SDK, and WebView2. Python 3.12 with PyMuPDF and Pillow is needed only for PDF acceptance tests.

```powershell
npm ci
./scripts/prepare-binaries.ps1
npm run tauri dev
```

If Cargo is missing from PATH, add `$env:USERPROFILE\.cargo\bin`. The preparation script downloads pinned upstream binaries, checks their SHA-256 digests, and includes license notices and Pandoc source. End users need none of these development tools.

```powershell
python -m pip install PyMuPDF==1.26.6 Pillow==12.0.0
./scripts/build-windows.ps1
```

Outputs: `src-tauri/target/release/bundle/nsis/Folio_0.2.0_x64-setup.exe` and `dist/Folio-0.2.0-windows-x64-portable.zip`. The installer is unsigned. Windows may show an unrecognized-publisher prompt.

Both npm and Cargo lockfiles are checked in. `rust-toolchain.toml` pins Rust. `.github/workflows/windows.yml` performs the build and publishes artifacts on Windows. This is a reproducible dependency/build procedure; signed or byte-for-byte deterministic installer reproducibility is not claimed.

## Verification

```powershell
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo build --locked --manifest-path src-tauri/Cargo.toml --bin folio-render
python scripts/verify-pdfs.py
```

PDF tests exercise genuine text reflow, column-rule coordinates and absence, title clearance, intersections with text, paper geometry, mirrored margins, images, links, footnotes, missing resources, raw-code filtering, font fallback and source integrity. They leave inspectable PDFs, page images and a JSON report under `verification/`.

For native WebView2 interaction verification, start a development build with `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'`, then run `node scripts/verify-native.mjs`. This development-only flag is never set by the shipped app. The script uses real native IPC, rendering and controls; it does not substitute a mock renderer.

## Scope and limits

- Document-wide equal-width columns, one through four in the inspector; the validated schema supports up to six where usable. No arbitrary section layouts or full-width mid-document figures.
- Headings H1–H6, quotes, tables, figures, code, links and footnotes receive cohesive styling. Only the useful common element controls are exposed.
- Very wide tables, unusually long unbreakable text, and code may need fewer columns, smaller type or source line breaks. Compilation warnings about content that cannot fit become errors. Code lines exceeding a conservative column-width limit are rejected with a specific error. Inspect pages before publishing; PDF compilation alone cannot establish visual correctness for every possible Markdown document.
- The title spans columns when supplied as metadata or an inspector override. A normal Markdown H1 remains a body heading.
- Preview pages render lazily, with selectable text and hyperlink overlays. Preview navigation is deliberately compact; it is not a full PDF annotation application.
- Preferences persist locally; unsaved edits are not automatically recovered after a machine crash.
- This machine can verify native execution and packaging. A separate pristine Windows VM is still required to certify a clean-machine install, runtime installation and actual printer behavior.

See `THIRD-PARTY-NOTICES.md` and `DEPENDENCIES.json` for distribution and licensing details.
