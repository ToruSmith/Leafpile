# Leafpile

English · [繁體中文](README.md)

**One folder. Notes by day, slides on stage.**

Leafpile connects two things that are usually done twice: you collect notes in Markdown, promote them into a 3D card-pile slide deck when it is time to share, and save the Q&A back into your notes afterwards. Files stay on your computer or USB drive; the website only reads them. Nothing to install, nothing uploaded.

> **Status: v0.0.1 — plan and scaffold.** This repository holds the format spec, default categories, examples, a content guard and the project documents. The web app will grow out of the [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile) engine in phase 1. Until then, `slides/` already plays in Mdslide Pile, and `notes/` opens in any Markdown editor such as Obsidian.

## The idea

```
my-library/
├─ _site.yml        library settings and categories (optional)
├─ notes/           notes channel: one .md = one note
│  └─ 10-reading/   a topic
├─ slides/          slides channel: Mdslide Pile format, one .md = one slide
│  └─ 10-reading/   same folder name = same topic, paired automatically
├─ boards/          canvases (JSON Canvas)
└─ _archive/        archived files; Leafpile never deletes your files
```

**Notes are the single source of knowledge; a deck is one performance.** Content can be linked or copied once across channels, but is never synced both ways.

| Bridge | Direction | Changes files? |
|---|---|---|
| `[[links]]` and backlinks | both | no |
| ▶ Flash play | play a note as slides, temporarily | no |
| `![[note#heading]]` excerpt | a note section inside a slide | no |
| Promote to deck | note → new deck skeleton | adds files, then they diverge |
| After-talk note | speaker notes and Q&A → new note | adds a file |

Full rules: [`docs/INTEROP.md`](docs/INTEROP.md) (Traditional Chinese).

## Use it today

1. Copy the structure of `content/` into your own folder.
2. Play decks: open [Mdslide Pile](https://torusmith.github.io/Mdslide-Pile/) and choose your `slides/` folder.
3. Write notes in any editor, following [`docs/SPEC.md`](docs/SPEC.md).
4. Before pushing to GitHub:

```bash
node scripts/guard-content.mjs content   # size, paths, visibility, expiry, personal data
node --test tests/*.test.mjs             # unit tests (Node 18+, no npm install)
```

## What goes on GitHub

GitHub Pages sites are always public, so `content/` is public. Keep it small and public: images ≤ 300 KB, text files ≤ 100 KB, 20 MB in total, videos and PDFs as links only, ASCII paths, and `expires` on pinned urgent notes. Private or work content stays on your computer.

## Lineage

Leafpile merges two projects by the same author: [Mdslide Pile](https://github.com/ToruSmith/Mdslide-Pile) (deck format, local-first engine, zero dependencies) and [reading-notes-vault](https://github.com/ToruSmith/reading-notes-vault) (note front matter, categories and topics, public/private rules, personal-data scan, JSON Canvas boards).

## Contributing, credits, license

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CONTRIBUTORS.md`](CONTRIBUTORS.md), [`AI_CREDITS.md`](AI_CREDITS.md), [`SECURITY.md`](SECURITY.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Code is MIT ([`LICENSE`](LICENSE)); docs and example content are CC BY 4.0 ([`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)). Your own notes and decks remain yours.
