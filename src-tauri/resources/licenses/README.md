# Bundled notices

Run `scripts/prepare-binaries.ps1` to obtain upstream tool notices and Pandoc source. Run `node scripts/collect-licenses.mjs` after `npm ci` and Cargo dependency resolution to collect npm and Rust notices. Generated files accompany packaged resources and are excluded from source control because the build recreates them.
