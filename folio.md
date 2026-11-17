# Project Folio
## Windows Markdown-to-PDF Desktop Publisher
### Implementation instructions for Codex

## 1. Objective

Build a fully functional, locally installed Windows desktop application called **Folio**.

Folio is a visual typesetting and PDF publishing application for Markdown documents.

Its purpose is to make sophisticated document formatting accessible through a compact, carefully designed graphical interface.

The user should be able to open a Markdown document, choose a layout, change its typography and page geometry, preview the actual rendered result, and export a professionally typeset PDF.

Think of it as a simplified graphical front end to a LaTeX-like publishing pipeline.

It is not intended to be a general-purpose word processor, an online document service, or a full LaTeX editor.

The fundamental interaction is:

**Open Markdown → Adjust formatting → Inspect pages → Export PDF**

The user should never need to write Typst or LaTeX code to use the application's ordinary features.

You are responsible for implementing the actual application, not merely producing a specification, mockup, or prototype.

## 2. Technical architecture

Preferred stack:

- Tauri 2 for the Windows desktop application.
- React, TypeScript and Vite for the interface.
- Rust for native filesystem access and process orchestration.
- CodeMirror 6 for Markdown source editing.
- Pandoc for Markdown parsing and conversion to Typst.
- Typst for final typesetting and PDF compilation.
- PDF.js for displaying the actual generated PDF inside the application.
- CSS variables and handcrafted styling for the interface.

Avoid Electron unless an unavoidable technical issue establishes a compelling reason to switch.

The complete publishing pipeline should work offline.

Package Pandoc and Typst as managed local binaries or Tauri sidecars so the end user does not need to install Python, Node.js, LaTeX, Pandoc or Typst separately.

Pin compatible versions, account for bundled binary licensing and redistribution requirements, and provide a reproducible Windows build.

### Rendering pipeline

Implement the following flow:

1. Load the Markdown source.
2. Load its associated Folio formatting configuration.
3. Convert Markdown into Typst through Pandoc.
4. Generate the necessary Typst preamble and document template based on formatting settings.
5. Compile the Typst document to PDF.
6. Load the resulting PDF into the preview pane.
7. Repeat when the source or layout settings change.

The preview must display the PDF produced by the same compilation pipeline used for export.

Do not create an HTML approximation of the layout and pretend it represents the eventual PDF.

Manage temporary files and resources safely. Resolve local image references relative to the source document, handle filenames containing spaces, and preserve Unicode.

Run compilation asynchronously. Debounce rapid changes, cancel or supersede obsolete jobs, and never replace a newer preview with an older render result.

If compilation fails, retain the last successful preview and show an intelligible error rather than an empty screen.

## 3. Visual design

This is an unusually important part of the project.

**The interface must feel like a refined desktop publishing instrument, not a modern SaaS dashboard.**

Avoid:

- Gradients of any kind.
- Neon or highly saturated accent colors.
- Giant rounded cards.
- Decorative shadows.
- Excessive buttons.
- Dashboard tiles.
- Marketing illustrations.
- Oversized headings or excessive whitespace.
- Floating action buttons.
- Chat interfaces or AI assistants.
- Tooltips and onboarding text for self-explanatory operations.
- Excessive animations.
- Unnecessary icons.

Design inspiration should come from editorial publishing software, traditional print shops, professional typography tools, and understated desktop productivity applications.

### Visual language

Use a restrained palette:

- Application background: warm, very light gray.
- Preview workspace: slightly darker neutral gray.
- Panels: soft off-white.
- Primary text: charcoal.
- Secondary text: muted gray.
- Accent: restrained dark blue-gray or desaturated ink color.
- Borders: thin, neutral, unobtrusive.

Use typography deliberately.

A tasteful serif can be used for the application's wordmark or document titles. Interface labels should use a crisp, highly readable system sans-serif.

Avoid gratuitous capitalization.

Controls should be compact without being cramped.

Use square or subtly rounded corners. Prefer fine dividing lines over cards or shadowed containers.

Use Lucide icons sparingly and only where they communicate an action.

### Primary window layout

Design a three-pane working environment:

**Left: Markdown editor**

Approximately 30–35% of the available width.

**Center: PDF preview**

The largest and most visually important area, taking the remaining flexible width.

**Right: Formatting inspector**

Approximately 260–320 pixels wide, with collapsible groups of controls.

Above these panes, use a slender application toolbar containing:

- Folio wordmark.
- Current document filename.
- Save indicator.
- Open.
- Save.
- Export PDF.
- A small control for hiding or showing the editor and inspector.

Do not add buttons simply to fill space.

Every part of the window should be resizable where appropriate.

Persist panel dimensions and visibility between sessions.

Support reasonable smaller Windows display sizes by collapsing the inspector when necessary.

The design should look intentional at 1366×768, 1920×1080, and larger resolutions.

## 4. Primary formatting features

Build a working formatting inspector with the following groups.

### A. Page

Provide controls for:

- Paper size: Letter, A4, Legal, A5, and custom dimensions.
- Orientation: Portrait or landscape.
- Top, bottom, left and right margins.
- Linked margins for changing all four together.
- Measurement units: inches, millimeters and points.
- Page background color.
- Optional page numbering.
- Optional running header and footer.
- Optional mirrored inside/outside margins for book-style documents.

Defaults should produce a tasteful, readable document.

Background colors must be represented in the generated PDF. Do not force white pages for the sake of conserving printer ink.

### B. Columns

This is a core application feature, not an enhancement.

The inspector should include a particularly clean, intuitive section for multicolumn layout.

Controls:

**Columns:** 1, 2, 3, 4, with provision for more if supported.

**Gutter:** Numeric control with appropriate units.

**Vertical rule:** On/off.

**Rule thickness:** Adjustable in points.

**Rule color:** Compact color control.

**Rule inset:** Optional top and bottom spacing.

Changing the number of columns must produce a genuine reflow of the document text.

Columns should be equal-width in the first release.

Vertical rules must appear between columns, centered in the gutters.

They must:

- Appear consistently on every applicable page.
- Remain centered when the gutter changes.
- Respect page margins.
- Never overlap body text.
- Scale correctly when page dimensions change.
- Disappear completely in single-column mode.

Typst supports page columns but does not expose a native column-rule property. Implement the rules using appropriate Typst page background or foreground geometry. Calculate their positions from page dimensions, margins, column count and gutter width.

Do not implement separator rules as text characters or fake CSS decoration in the preview.

Handle full-width titles or introductory material without drawing separators through their text.

Make the first release's document-wide column settings completely reliable before attempting arbitrary per-section changes.

### C. Typography

Provide controls for:

- Body font family.
- Body font size.
- Heading font family.
- Heading scale.
- Line spacing.
- Paragraph spacing.
- First-line paragraph indentation.
- Text alignment: left or justified.
- Text color.
- Heading color.

Use installed system fonts. Provide a curated selection of sensible defaults, with access to other available fonts where practical.

Support regular, bold and italic styles.

Typography settings should be reflected in the PDF immediately after successful compilation.

Avoid changing the Markdown source simply to alter its visual appearance.

### D. Document elements

Provide formatting options for:

- Heading hierarchy H1–H6.
- Blockquotes.
- Ordered and unordered lists.
- Horizontal rules.
- Code blocks.
- Tables.
- Image captions.
- Figure spacing.
- Hyperlink appearance.
- Footnotes.
- Table of contents.

These do not all need independent controls in the initial inspector.

Start with cohesive preset styling and expose the most useful adjustments.

Prioritize typographical consistency and reliable pagination.

Headings should not be stranded at the bottom of a page when an appropriate keep-with-next behavior can prevent it.

Images should retain their aspect ratio and stay within the available page or column width.

Large tables and code blocks should handle narrow columns gracefully. Prefer an explicit, understandable limitation to silently clipped or corrupted content.

### E. Presets

Include at least four professionally designed formatting presets:

1. **Manuscript:** Spacious, traditional, single-column reading layout.
2. **Essay:** Elegant typography, generous margins, careful headings.
3. **Journal:** Compact two-column layout with restrained hierarchy.
4. **Reference:** Dense, space-efficient formatting, suitable for printing technical notes and guides.

Every preset should configure a coherent combination of paper geometry, typography, spacing, columns and rules.

Presets are starting points, not locked templates.

When a user changes one setting, all other settings should remain unchanged.

Allow a user to save, rename, load and delete their own presets.

## 5. Markdown editing

The editor should be useful but not overengineered.

Use CodeMirror 6 with:

- Markdown syntax highlighting.
- Line numbers, optionally hidden.
- Automatic indentation.
- Undo and redo.
- Find and replace.
- Word wrap.
- Keyboard shortcuts.
- Clear visual distinction between headings, code and body text.

Support standard Markdown, fenced code blocks, tables, images, links, footnotes and YAML front matter where compatible with the rendering pipeline.

Keep syntax highlighting restrained.

Do not turn the editor into a block-based WYSIWYG application.

Allow the user to:

- Open `.md` and `.markdown` files.
- Drag and drop a Markdown file onto the application.
- Edit its source.
- Save changes.
- Save As.
- Reload the file from disk.

Preserve the source document faithfully. Layout changes must never rewrite or reformat the Markdown.

When a file has unsaved source changes, indicate this unobtrusively and protect it from accidental loss.

## 6. PDF preview

The PDF preview is the visual centerpiece of Folio.

Use a real embedded PDF renderer, preferably PDF.js.

Provide:

- Continuous vertical page scrolling.
- Fit to width.
- Fit page.
- Zoom in/out.
- Numeric zoom percentage.
- Page count and current page.
- Optional two-page view.
- Smooth, responsive navigation.
- Sensible scroll position retention after a layout change, when possible.

Render pages against a neutral work surface.

Use a subtle page shadow or boundary to distinguish the printable page from its surroundings. Keep this understated.

Do not clutter the preview with a large toolbar.

There should be no perceptible difference between the latest successful preview and the exported PDF.

### Preview updates

Recompile automatically after changes, with a reasonable debounce period.

Provide a subtle status indication such as:

- Ready
- Rendering
- Updated
- Compilation error

Do not display modal dialogs for ordinary rendering operations.

Provide a manual refresh action if necessary.

## 7. Document persistence

Use a straightforward, human-readable configuration format.

The original Markdown remains its own file.

Save the Folio layout configuration in an adjacent JSON file.

For example:

`my-document.md`

`my-document.folio.json`

This configuration should contain:

- Schema version.
- Selected preset.
- Page dimensions and margins.
- Columns and separators.
- Typography.
- Header/footer settings.
- Document-specific formatting preferences.

Use a typed schema with validation, defaults and migration support for future versions.

Opening a Markdown document should automatically load an existing matching Folio configuration.

If none exists, use the application defaults.

Do not make the user create a proprietary document file before they can work.

Store recent document history, window layout and user-created presets separately in the application's local configuration directory.

Provide an easy way to reset a document's styling to a known preset.

## 8. Exporting and printing

### PDF export

Provide an obvious **Export PDF** action.

The exported PDF should:

- Use the currently selected layout settings.
- Match the preview.
- Preserve vector text and rules.
- Preserve embedded image quality when possible.
- Include appropriate document metadata.
- Preserve hyperlinks.
- Support searchable/selectable text.
- Preserve document structure and bookmarks where supported.

Use normal Windows Save As dialogs.

Remember the previous export directory.

Do not silently overwrite an existing PDF.

### Printing

Include a standard Print action.

The simplest acceptable implementation is to export the current document to a temporary PDF and open it through a reliable Windows PDF printing workflow.

Avoid writing a custom printer interface.

Do not sacrifice export quality for preview speed.

### Advanced export

If practical, provide an optional **Export Typst Source** action so more technical users can inspect or modify the generated typesetting document.

This belongs under an advanced menu, not the main toolbar.

## 9. Useful document controls

Support a small collection of document-oriented commands accessible through a compact Insert menu or editor command palette:

- Page break.
- Column break.
- Horizontal divider.
- Table of contents.
- Image.
- Footnote.

Where a standard Markdown representation exists, use it.

For layout-only instructions, use a documented, deliberately limited directive syntax that the conversion pipeline recognizes.

For example, a reserved HTML-comment-style directive could represent a page or column break without changing the Markdown's ordinary readable content.

Ensure the conversion code interprets these directives safely and predictably.

Do not build a general plugin language or arbitrary macro system in the first release.

## 10. Rendering correctness and reliability

This is a publishing tool. Formatting accuracy is the point.

Handle:

- Markdown escaping.
- Unicode punctuation.
- Literal special characters.
- Nested lists.
- Multiple heading levels.
- Relative image paths.
- Tables.
- Inline and display mathematics where supported.
- Code blocks with preserved whitespace.
- Footnotes.
- Long documents.
- Missing font fallbacks.
- Unexpected Pandoc or Typst failures.

Validate numerical settings.

Prevent impossible page configurations, such as margins consuming the entire printable area or columns becoming unusably narrow.

Show clear, specific errors when the underlying converter or compiler fails.

Never display a successful-export message until the PDF actually exists and has been written.

Do not pass unsanitized, user-editable strings directly into generated Typst code.

Keep filesystem access scoped appropriately and prevent unexpected network requests.

No telemetry, account system, analytics, cloud synchronization or internet dependency is required.

## 11. Required implementation sequence

Work in the following order.

### Phase 1: Functional rendering foundation

Create the Tauri application and establish the complete Markdown → Pandoc → Typst → PDF pipeline.

Verify that ordinary Markdown produces a valid PDF.

Ensure the binaries can be used without system-wide installation.

Implement proper error reporting.

### Phase 2: Application workspace

Build the native desktop window, Markdown editor, PDF preview, file handling and basic persistence.

Establish the intended visual language now, rather than building a generic dashboard and attempting to restyle it afterward.

### Phase 3: Page layout controls

Implement paper size, margins, page background, orientation, typography, column count and gutters.

Connect every control to the actual renderer.

### Phase 4: Column separator rules

Implement and test vertical rules at multiple page sizes and column counts.

Verify their geometry using actual rendered PDF pages.

This feature is explicitly required for the first usable release.

### Phase 5: Presets and publishing

Implement formatting presets, document-specific saved configurations, export, printing, and the remaining document settings.

### Phase 6: Polish and packaging

Improve keyboard interactions, error handling, resizing, empty states, long-document performance and general interface consistency.

Create a distributable Windows application.

Prioritize a complete, dependable core application over adding a large number of marginal features.

## 12. Acceptance tests

Prepare test documents and automated tests demonstrating the following:

1. A Markdown document opens successfully and renders to PDF.
2. Switching from one to two to three columns changes the actual PDF geometry and text flow.
3. Changing gutter width updates the layout correctly.
4. Enabling vertical rules produces correctly positioned separators across multiple pages.
5. Disabling rules removes them entirely.
6. Changing typography and margins affects the PDF correctly.
7. Switching Letter to A4 and portrait to landscape works.
8. Links, lists, headings, code blocks, images and footnotes survive conversion.
9. A saved Folio configuration restores the selected formatting after restarting the application.
10. Changing formatting does not alter the Markdown source.
11. The preview and exported PDF are generated from the same layout.
12. Missing images and compilation failures produce readable errors without destroying unsaved work.
13. The application remains usable with a long, multipage document.
14. The packaged Windows application works on a clean machine without separately installed Pandoc or Typst.

Use automated unit and integration tests for the conversion and configuration systems.

Where feasible, render PDF pages as images to verify pagination, line placement, clipping and column geometry.

Include a sample document with enough content to test multicolumn layouts across several pages.

Do not mistake a successful compilation for proof of a visually correct document.

## 13. Deliverables

Produce a complete source repository containing:

- Tauri application.
- React/TypeScript frontend.
- Rust native backend.
- Typst templates and rendering helpers.
- Formatting preset definitions.
- Configuration schemas.
- Sample Markdown documents.
- Tests.
- Dependency and license notices.
- README with setup and build instructions.
- PowerShell build script for Windows.
- Reproducible Windows packaging workflow, preferably using GitHub Actions.

The desired final deliverable is an installable Windows application, preferably an NSIS installer, with a portable distribution if practical.

If you cannot execute the Windows build in the current environment, provide a Windows CI workflow that builds and tests it rather than claiming that unverified binaries work.

## 14. Quality requirements

These are non-negotiable.

**No decorative controls.** Every visible control should perform a meaningful action.

**No fake preview.** The user must see the real typeset result.

**No brittle font assumptions.** Handle fonts that may not exist on another Windows machine.

**No unnecessary complexity.** Prefer a straightforward, understandable implementation over elaborate abstractions.

**No placeholder features presented as complete.** Implement, verify, or clearly exclude them from the initial release.

**No dependency on online services.** The publishing workflow should remain fully local.

**No generic SaaS appearance.** The visual interface is part of the product's purpose, not an afterthought.

**No unnecessary explanatory prose inside the application.** Labels, tooltips where useful, and concise errors are sufficient.

## 15. Final design principle

Folio should feel like an instrument for composing printed pages.

Its complexity belongs in the rendering pipeline, not in the user's workflow.

Someone with an ordinary Markdown document should be able to open it, choose two columns, adjust a few typographical settings, add a fine vertical rule between the columns, and export a polished PDF without writing a single line of typesetting code.

That experience is the definition of success.

Proceed with implementation. Make reasonable technical decisions independently, document consequential deviations, and verify the software instead of stopping at a planning stage.