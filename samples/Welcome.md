---
title: The shape of a page
author: A Folio specimen
---

## A place for words

A page begins with a few simple decisions: the measure of a line, the space around it, and the rhythm of the type. Together they give writing a shape that can be read, held, and shared.

Folio brings those decisions into view. Choose a preset, adjust the margins, or set the text in two columns. The page in the center is the actual PDF, composed locally on your computer.

## Measure and rhythm

The length of a line changes how a paragraph feels. A generous single column invites sustained reading. Two columns make shorter passages easy to scan, while a fine rule can quietly distinguish one stream of text from the next.

> Typography is a way of arranging attention. Its best decisions are often the ones a reader never notices.

### A small working method

1. Open a Markdown document.
2. Choose a starting layout in the inspector.
3. Adjust the type and page geometry.
4. Inspect the pages and export your PDF.

The source remains ordinary Markdown. **Emphasis**, *italics*, links, lists, tables, and footnotes belong to the writing; the formatting lives in a small companion file.[^layout]

| Layout | Character |
|:-------|:----------|
| Manuscript | Spacious and traditional |
| Essay | Considered and readable |
| Journal | Compact, in two columns |
| Reference | Dense and practical |

## Space between things

White space gives the eye somewhere to rest. A margin frames the text; a gutter separates columns; a little space above a heading makes a new thought visible before it has been read.

The same principle applies to the workspace. The editor holds the words, the inspector holds the decisions, and the page shows their result.

### Notes in the margin

Code, mathematics such as $a^2 + b^2 = c^2$, and technical notes can share the page with prose:

```text
Words → Measure → Rhythm → Page
```

Read more about [Markdown](https://commonmark.org/). Publishing does not require a network connection; hyperlinks are preserved in the exported document.

[^layout]: Save the document to keep its layout in an adjacent `.folio.json` file.
