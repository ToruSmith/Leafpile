# Leafpile library pack spec (for AI)

> This is for AI: the user gives you material (pasted or attached). Follow this spec to make a **library pack** that Leafpile can import directly.
> The full spec is [`SPEC.md`](SPEC.md); slide layouts in detail are in [`slides/GUIDE.en.md`](slides/GUIDE.en.md). This short version is enough.

## 1. What to deliver

- **One zip file** (suggested name `leafpile-pack.zip`) whose root holds `notes/`, `slides/`, `boards/` (whichever you use).
- If you cannot create files, use the **text pack** in section 7 and output only the file blocks, no other explanation.
- Use the topic folder the user names (for example `10-reading`); otherwise `01-inbox`.
- File and folder names: lowercase letters, digits and `-` only (put the human title in `title`); date prefixes use today.
- UTF-8, LF line endings, YAML indented with spaces.

```
leafpile-pack.zip
├─ notes/10-reading/2026-11-13-atomic-habits.md
├─ slides/10-reading/2026-11-atomic-habits-share/
│  ├─ deck.yml
│  ├─ 01-why/01-hook.md
│  └─ 02-how/01-four-laws.md
└─ boards/atomic-habits-map.canvas
```

## 2. Content rules (most important)

1. **Use only what is in the material.** Do not add facts it lacks; background you add is marked "(added, to be checked)". Numbers and quotes must be traceable to the material.
2. **Be useful, not just an outline**: each point gets "what → why → example or quote".
3. **Conclusion first**: the first paragraph says the whole thing in one or two sentences.
4. For news or reports, separate "facts", "what each side says" and "not yet settled".
5. The user's extra requests (length, audience, tone, slide count) override these defaults.

## 3. Notes (`notes/<topic>/YYYY-MM-DD-<slug>.md`)

```markdown
---
title: "Atomic Habits: 1% better every day"
date: 2026-11-13
tags: [habits, reading]
public: false
source: <URL or book title; omit if none>
---
# Atomic Habits: 1% better every day

In one sentence: habits come from systems; changing the system beats willpower.

## Key points
### 1. Identity matters more than goals
Why…
> Quote (chapter 2)

## Examples
…

## To be checked
- …

## Related
- [[Title of another note]]
```

- Long material (a book, a long report): split into several notes **plus an overview note** that links to each with `[[note title]]`.
- Chapters of one book can live in a notebook folder `notes/<topic>/2026-11-<slug>/` with `_book.yml` (`title`, `author`, `status: reading`) and `01-xxx.md`, `02-xxx.md`.
- No layout settings in notes (`layout`, `size`). Allowed: headings, lists, checkboxes, quotes, tables, `==highlight==`, footnotes, `[[links]]`. No raw HTML.
- Length follows the material: usually 300–1200 words.

## 4. Decks (`slides/<topic>/YYYY-MM-<slug>/`)

**Folders are the structure**: deck → chapter folder `01-xxx/` → slide file `01-xxx.md` (one slide per file).

`deck.yml`:

```yaml
mdslide: 1
title: "Atomic Habits: make good habits automatic"
subtitle: Book club
date: 2026-11-13
theme: paper          # paper / ink / slate / sepia / nord
lang: en
end: Thank you
sections:
  - folder: 01-why
    title: Why goals fail
    color: "#c0674a"
  - folder: 02-how
    title: The four laws
    color: "#4f73a6"
```

A slide (for example `01-why/01-hook.md`):

```markdown
# The title states the conclusion: change the system

- Point one, **bold** uses the chapter color
- Point two
- Point three

Note:
Speaker notes: tell the example from the book here.
```

Layouts (write `<!-- layout: name -->` at the top of the file; omit to auto-detect):

| Layout | How |
|---|---|
| `number` | `## 37x` then one line of explanation |
| `stats` | `- **3x** explanation`, 2–4 items |
| `quote` | `> quote` then `— source` |
| `timeline` | `- **2024** event`, sub-items allowed |
| `columns` | split columns with a line `+++` |
| `grid` | 3–6 blocks split with `+++` |
| `flow` | each list is a row; arrows are drawn between items |
| `chart` | front matter `layout: chart`, `chart: bar`, body is one table |
| `center` | one centered statement |

Rules:

- One idea per slide; titles state conclusions; at most 5 bullets, one line each.
- Default 10–15 slides in 2–4 chapters, 3–6 per chapter; the first slide may be `<!-- layout: agenda -->` (automatic outline; body just `# Agenda`).
- Every 3–4 slides, use a `number`, `quote`, `stats`, `timeline` or `columns` slide; not all bullets.
- Details go in `Note:`; the last chapter is "conclusion / next steps".
- The title slide and chapter covers are generated automatically: **do not make them**.
- No image links unless you have real images.

## 5. Boards (`boards/<slug>.canvas`, JSON Canvas)

```json
{
  "nodes": [
    { "id": "g1", "type": "group", "label": "Core ideas", "x": 0, "y": 0, "width": 340, "height": 420, "color": "5" },
    { "id": "c1", "type": "text", "text": "**Identity**\nDecide who you want to become first", "x": 20, "y": 50, "width": 300, "height": 110 },
    { "id": "n1", "type": "file", "file": "notes/10-reading/2026-11-13-atomic-habits.md", "x": 400, "y": 50, "width": 300, "height": 110 }
  ],
  "edges": [
    { "id": "e1", "fromNode": "c1", "fromSide": "right", "toNode": "n1", "toSide": "left", "label": "details" }
  ]
}
```

- 3–6 groups, 3–8 cards each; groups left to right with 60 between; cards 300 wide, top to bottom with 20 between; each group encloses its cards.
- Card text is Markdown: a bold first line as a heading, then one or two sentences (not a single word).
- Every edge has a `label` ("causes", "example", "opposite"…); at most 10, only real relations.
- `color` is `"1"`–`"6"` (red, orange, yellow, green, cyan, purple).
- To point to a note, use a `file` node whose path is a note in the same pack (or an existing path the user gave you); for a deck use `"file": "slides/…/deck.yml"` plus `"x-kind": "deck"`.
- Every `id` is unique; `fromNode` and `toNode` must exist.

## 6. Self-check before delivering

- [ ] Paths start with `notes/`, `slides/`, `boards/`; folder names use only lowercase letters, digits and `-`.
- [ ] Every note has front matter (`title`, `date`) and a one-line conclusion; every `[[link]]` target is in the pack.
- [ ] Every deck has `deck.yml`; chapter folders match `sections` `folder`; no list longer than 5.
- [ ] Boards are valid JSON and both ends of every edge exist.
- [ ] No facts beyond the material; uncertain items are marked "to be checked".

## 7. Text pack (when you cannot create a zip)

Each file starts with a line `=== FILE: path ===` and ends with a line `=== END ===`; the reply contains only these blocks:

```text
=== FILE: notes/10-reading/2026-11-13-atomic-habits.md ===
---
title: "Atomic Habits: 1% better every day"
date: 2026-11-13
---
# Atomic Habits: 1% better every day
…
=== END ===
=== FILE: slides/10-reading/2026-11-atomic-habits-share/deck.yml ===
mdslide: 1
title: Atomic Habits
=== END ===
```

The user gives the zip or this text to Leafpile; it previews the import and never overwrites the user's files.
