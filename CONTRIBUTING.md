# Contributing to Folio

Folio is maintained by Justin Bogner/CambrianMinds. Contributions are welcome through this repository's issues and pull requests.

## Development setup

Follow the Windows x64 prerequisites and setup commands in [README.md](README.md#build-on-windows-x64). Run commands from the repository root. Native rendering requires the managed binaries prepared by `scripts/prepare-binaries.ps1`. A Vite-only session supports frontend work, while `npm run tauri dev` exercises the native application.

## Reporting bugs

Include your Folio version, Windows version, reproduction steps, expected behavior, and actual behavior. For rendering problems, attach a minimal Markdown example, its `.folio.json` settings, and any required image assets you are comfortable sharing. A screenshot of the problem can help. Remove personal information from examples and logs before uploading them.

Use the [security reporting guidance](SECURITY.md) for vulnerabilities.

## Making changes

- Keep changes focused and explain the user-visible behavior in the pull request.
- Preserve source text when changing layout, validate settings at the native boundary, and ensure exported PDFs match the successful preview.
- Update the README when changing controls, shortcuts, requirements, or supported behavior.
- Edit `src/templates.ts` and the template exporter for schema changes, then regenerate `templates/` with `node scripts/export-templates.mjs`.
- Preserve existing copyright and third-party notices. Contributions are provided under the project's GPL-2.0-or-later license. Retain attribution for contributed work and identify any third-party material you add.

Run the relevant checks before opening a pull request. The standard verification sequence is below.

```powershell
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo build --locked --manifest-path src-tauri/Cargo.toml --bin folio-render
python scripts/verify-pdfs.py
node scripts/export-templates.mjs
python scripts/verify-spacing.py
```

PDF checks require the development Python packages listed in the README. The full Windows build runs these checks and collects dependency notices. Native WebView2 interaction checks are documented in the README.

## Release procedure

1. Set the release version consistently in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Update the versioned output paths in the packaging scripts and README.
2. Build from a reviewed checkout with `./scripts/build-windows.ps1`. Resolve any test failures. Review regenerated `DEPENDENCIES.json` and template changes.
3. Inspect the installer and portable ZIP. Confirm the copyright attribution, GPL text, third-party notices, Pandoc source archive, and `resources/folio-source.zip` are present. Extract the source archive and confirm it contains the release's source, templates, lockfiles, and build scripts.
4. Test installation and portable launch on a clean Windows x64 machine. Check WebView2 setup, opening a sample, PDF preview and export, and opening the PDF for printing. Record the tested Windows version and any remaining limitations in release notes.
5. Publish the installer and portable ZIP with their SHA-256 hashes and release notes. Provide corresponding source alongside binary downloads, including the bundled source archives and required third-party material. Preserve the copyright and license notices in redistributed builds.

GitHub Actions uploads build artifacts. Publishing a GitHub Release is a separate maintainer action. Current packages are unsigned.
