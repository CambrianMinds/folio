# Security

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** option when private vulnerability reporting is enabled. Include the affected version, reproduction steps, impact, and a minimal example with personal information removed.

If that option is unavailable, ask the maintainer for a private reporting channel through their public GitHub profile or a general issue that omits exploit details. Share exploit details after a private channel is established.

Security fixes are reviewed for the current development version. No response-time commitment or long-term support schedule is established.

## Local data and network access

Folio stores document layout settings beside the Markdown file and preferences under `%APPDATA%\local.folio.publisher`. Optional model weights live under `%LOCALAPPDATA%\Folio\models`. Rendering uses temporary working files, including snapshots of document images. Printing opens a temporary PDF in the system PDF application.

The publishing pipeline runs locally. Dependency setup and optional model downloads use the network. Following a PDF hyperlink can open an external website. External-model templates are exchanged through user-controlled copy, paste, and JSON files.

Images are restricted to the document directory and its subdirectories. The rendering pipeline filters raw document code and blocks remote images and Typst package fetching. Keep Folio and its managed rendering dependencies updated when handling documents from other people.

The remote-debugging flag documented for native verification exposes development controls. Enable it only during local testing and close the development session afterward.
