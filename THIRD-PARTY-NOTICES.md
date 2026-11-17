# Third-party software

Folio source is licensed under GPL-2.0-or-later. Its components retain their respective licenses. Packaging aggregates independent command-line tools; this notice does not relicense them or user's documents.

| Component | Pinned version | License / source |
| --- | --- | --- |
| Pandoc | 3.10.1 | GPL-2.0-or-later; https://github.com/jgm/pandoc/releases/tag/3.10.1 |
| Typst | 0.14.2 | Apache-2.0; https://github.com/typst/typst/releases/tag/v0.14.2 |
| Tauri | See Cargo.lock | MIT OR Apache-2.0; https://github.com/tauri-apps/tauri |
| React / React DOM | 19.2.0 | MIT; https://github.com/facebook/react |
| CodeMirror 6 | See package-lock.json | MIT; https://github.com/codemirror |
| @uiw/react-codemirror | 4.25.4 | MIT; https://github.com/uiwjs/react-codemirror |
| PDF.js | 5.4.624 | Apache-2.0; https://github.com/mozilla/pdf.js |
| Zod | 4.6.7 | MIT; https://github.com/colinhacks/zod |
| llama.cpp CPU runtime | b12445 | MIT and bundled third-party notices; https://github.com/ggml-org/llama.cpp/releases/tag/b12445 |
| arboard | See Cargo.lock | MIT OR Apache-2.0; https://github.com/1Password/arboard |
| Microsoft WebView2 Runtime | Installer downloaded by Tauri | Microsoft's runtime redistribution terms apply; https://developer.microsoft.com/microsoft-edge/webview2/ |

The managed tools are unmodified official Windows x64 release binaries. Their notices are copied from their release archives into `resources/licenses/pandoc/` and `resources/licenses/typst/`. Pandoc's versioned source archive accompanies distributions at `resources/licenses/pandoc-3.10.1-source.tar.gz`; its upstream release and source-build instructions are linked above. Keep the source and all license notices with redistributed copies. Distributors who change binaries must provide corresponding source and satisfy the applicable GPL requirements for their builds and dependencies.

Typst's archive includes its own third-party NOTICE and embedded font notices. Folio does not redistribute installed Windows fonts. Exported PDFs embed font subsets as permitted by the typesetter and font licensing; users are responsible for fonts they add.

The notice collection script copies license texts for npm dependencies and Rust crates to `resources/licenses/npm/` and `resources/licenses/rust/`, and produces a machine-readable inventory. Developer-only tools are listed in lockfiles; they are not required on end-user machines. The NSIS installer embeds Microsoft's offline WebView2 installer so a network connection is not needed to install the runtime.

The complete Folio application source, lockfiles, templates and build scripts accompany the binary at `resources/folio-source.zip`. Build dependencies are identified by the lockfiles and inventory. The license texts apply to the original components as indicated in each source file or package.

Folio contains no telemetry, account service or cloud publishing component.

Optional language weights: Qwen3-4B-Instruct-2507 (Apache-2.0), quantized as Q4_K_M by Unsloth. Model origin: https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507 ; pinned GGUF conversion: https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/tree/a06e946bb6b655725eafa393f4a9745d460374c9 . Weights are not included in the installer or portable archive. The optional preparation script installs the weights and accompanying license separately. Runtime notices, including LLVM OpenMP, are in `resources/licenses/llama.cpp/`.
