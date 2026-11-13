# Deck-Making Guide

This document explains how to turn a folder into a Mdslide Pile deck. **People and AI follow the same rules**: there is only one rulebook.

> 中文版:[製作專案指南.md](GUIDE.zh-Hant.md)
>
> New here and just want step-by-step instructions? Start with the [user manual](MANUAL.en.md) (operation, a copy-and-paste settings cheat sheet, fonts, colors).

> For AI: read this whole document before you start. When you are done, run `node scripts/check.mjs <folder>`; the job is finished only when it reports no problems. The last section is your workflow and acceptance checklist.

---

## 1. The one-minute version

```
my-library/                         ← library (on a hard drive or a USB drive)
├─ _site.yml                        ← library settings (optional)
├─ 01-teaching/                     ← topic
│  ├─ _topic.yml                    ← topic settings (optional)
│  └─ 2026-11-book-club/            ← project = one deck
│     ├─ deck.yml                   ← deck settings (recommended)
│     ├─ 01-problem/                ← section
│     │  ├─ 01-today.md             ← slide
│     │  └─ 02-data.md
│     ├─ 02-method/
│     └─ media/                     ← images and videos
└─ 02-work/
```

- **Folders are the structure**: library → topic → deck → section → slide.
- **One `.md` file is one slide** (you can also put several slides in one file, separated by `---`).
- **Every config file is optional**; folder names alone are enough to play.

You can open a whole library, one topic, or a single deck folder; the tool detects which level it is.

---

## 2. Folder and naming rules

| Rule | Meaning | Example |
|---|---|---|
| A number prefix sets the order | The prefix is hidden on screen | `01-problem` shows as "problem" |
| A date prefix | Treated as a date, not an order; decks without prefixes are sorted newest first | `2026-11-book-club` |
| Starts with `_` or `.` | Skipped, never played; good for drafts | `_draft.md`, `_old/` |
| Reserved folders | Hold media only, never become sections | `media/` `assets/` `images/` `img/` `video/` `videos/` |
| Documentation files | Never become slides | `README.md`, `AGENTS.md` |

**Naming tips** (topic and deck names matter, because you may later move or delete a whole folder):

- Topics: `01-teaching`, `02-work`; short nouns.
- Decks: `2026-11-book-club-notes`; a leading date makes them easy to sort and recognize.
- Sections: `01-problem`, `02-method`; two digits leave room to insert (`015-extra` also works).
- Slides: `01-today.md`; the file name is only for you, the screen shows the heading inside.
- Avoid `/ \ : * ? " < > |` in names.

**How the opened level is detected** (checked in this order):

1. Has `deck.yml` → single deck
2. Has `_topic.yml` → topic
3. Has `_site.yml` → library
4. Contains `.md` files directly → single deck
5. A subfolder has `deck.yml` → topic; a subfolder has `_topic.yml` → library
6. A subfolder contains `.md` files directly → single deck (the subfolders are sections)
7. Anything else → library

> For decks inside a topic, **always add a `deck.yml`** (a single line `title: My title` is enough); detection is then unambiguous.

---

## 3. Config files

Config files are YAML. Only the common syntax is supported: `key: value`, nesting by indentation, `- list items`, `[a, b]`, `|` multi-line text and `#` comments. **Indent with spaces, never tabs.**

### deck.yml (one deck)

```yaml
mdslide: 1                     # rule version, currently 1
title: A moving deck made with Markdown
subtitle: Book club, 2026
kicker: Book club · Session 12  # small text at the top of the title slide
author: Toru
event: Taipei Book Club
date: 2026-11-20
size: small                    # smaller text for the whole deck (data-heavy reports; optional)
theme: paper                   # paper / ink (dark) / slate / sepia / nord (dark)
lang: en                       # language of generated text (Thank you, Agenda…): zh-Hant / en; detected from the title when omitted
accent: "#b4654a"              # accent color when a section has none
cover_image: media/cover.jpg   # image on the right of the title slide (optional)
tags: [book-club, notes]
layout:
  stage: pile                  # opening stage: pile / coverflow / carousel / helix / sphere / overview / side (large slide + thumbnails; default on phones)
cover: true                    # false = no automatic title slide
section_covers: true           # false = no automatic section covers
end: Thank you                 # adds an automatic closing slide (optional)
end_notes: Q&A                 # speaker notes for the closing slide
cover_notes: |                 # speaker notes for the title slide
  Pause for three seconds first.
brand:                         # branding (optional)
  logo: media/logo.svg         # logo at the left of the footer on content slides (inside the deck folder)
  footer: ACME · Internal      # footer text (replaces the section name)
  font_display: Georgia        # heading font (a font name only; it must be installed)
  font_body: Inter             # body font
sections:                      # only overrides section properties; order always follows folder prefixes
  - folder: 01-problem
    title: "Problem: notes keep piling up"
    subtitle: Why we write so much and use so little
    color: "#c0674a"
    notes: About 5 minutes      # speaker notes for the automatic section cover
  - folder: 99-appendix
    hidden: true               # keep the files but do not play them
```

`brand` fonts accept font names only (letters, digits, spaces, `-`, `_`, `.`; separate several with commas). No external fonts are downloaded, and for safety custom CSS files in a deck folder are not supported.

Every field is optional. Defaults: the title comes from the folder name, section colors are assigned automatically, the theme is `paper` and the stage is `pile`.

Colors accept `#rgb`, `#rrggbb`, `#rrggbbaa`, numeric `rgb()` / `hsl()` and plain color names (`teal`). Anything else is reported and replaced by the default color.

### _topic.yml (one topic)

```yaml
name: Teaching
description: Book clubs and internal talks
color: "#4f73a6"
order: [2026-12-year-end, 2026-11-book-club]   # optional; defaults to prefix or date
```

### _site.yml (the whole library)

```yaml
title: Toru's slide shelf
description: One sentence about it
theme: paper                   # library page theme; switches to ink when the computer uses dark mode
topics: [02-work, 01-teaching]                 # optional
```

---

## 4. Writing slides

### Basics

It is ordinary Markdown:

```markdown
# The heading is the conclusion

- First point; **bold** is highlighted in the section color
- Second point; ==highlight== works too
  - Sub-items are smaller and grey
- [x] Checkbox
- [ ] Not done

A normal paragraph. Single line breaks inside a paragraph are kept.
```

Supported: headings, lists (ordered, unordered, nested, checkboxes), quotes, tables, code blocks, bold, italic, strikethrough, `==highlight==`, `inline code`, links and images. **Raw HTML is never rendered** (it is shown as text, for safety).

### Several slides in one file

Separate them with `---` **on a line of its own** (not inside code blocks):

```markdown
# First slide
---
# Second slide
```

### Speaker notes

Write `Note:` on a line of its own; everything after it is visible only in the presenter view:

```markdown
# Slide content

Note:
Mention last week's example here.
```

### Per-slide settings

Front matter at the **top of the file** applies to the whole file:

```markdown
---
layout: split-left
step: true
---
```

Or put settings at the **start of each slide**; they apply to that slide only (handy when a file holds several slides):

```markdown
<!-- layout: quote -->
<!-- color: #4f73a6 -->
```

| Setting | Meaning |
|---|---|
| `layout` | Layout, see the next section; default `auto` |
| `step: true` | Step-by-step reveal: list items, stat cards, timeline items, columns and agenda items appear one at a time |
| `color` | Accent color for this slide |
| `background` | Background: a file name is a background image (`media/photo.jpg`), a color is a background color (`"#1f3a5f"`, quoted). Text turns light on dark backgrounds and dark on light ones; use `#hex` colors so the brightness can be detected |
| `overlay` | Overlay on a background image: `auto` (default, fades toward the theme background) / `dark` (dark overlay, light text) / `light` / `none`. Photo backgrounds suit slides with little text: covers, quotes, big numbers |
| `text` | Text color (usually unnecessary; it follows the background) |
| `fit: contain` | Show media whole, without cropping |
| `size` | Text size: `small` (about 80% with tighter margins, for data-heavy slides; `compact` also works) / `normal` / `large` (about 115%) / `xl` (about 130%). Put it in `deck.yml` for the whole deck; `normal` on a slide undoes it |
| `font` | Font name for this slide, e.g. `Noto Serif TC` (must be installed; separate several with commas) |
| `align` | Text alignment: `left` (default) / `center` / `right` |
| `ratio` | Column widths as seen on screen (left:right): `2:1` for `split` and `split-left`; `columns` can use `1:1:2` |
| `footer: false` | Hide the footer |
| `hidden: true` | Do not play this slide |
| `title` | Title for the presenter view and overview (defaults to the first heading) |
| `chart` / `unit` | Chart type and unit (for the chart layout) |

### Images and video

An image on **a line of its own** is the slide's main media:

```markdown
![Caption](media/photo.jpg)
![Video caption](media/demo.mp4)
![Caption](https://www.youtube.com/watch?v=VIDEO_ID)
![Caption](media/photo.jpg "Text in quotes becomes the caption")
```

- **Paths**: `media/a.jpg` is relative to the **deck folder** (recommended; works from any section); `./a.jpg` is relative to the Markdown file.
- **Local formats**: images jpg, png, gif, webp, svg, avif; video mp4, webm, mov.
- **Online video**: YouTube, Bilibili, Google Drive (shared as "anyone with the link") and Vimeo. Paste the normal share URL. Needs a network connection.
- **Interactive pages**: same syntax; zoom into the slide and use the page right there.
  - An `.html` file in the deck folder, e.g. `![Caption](media/demo.html)`. Played from the repository (the site's built-in library), CSS, JS and images next to it load too; played from a local folder, make it a **single file** (CSS and JS inside the HTML).
  - A GitHub Pages page, e.g. `![Caption](https://user.github.io/project/)`.
  - A CodePen pen, e.g. `![Caption](https://codepen.io/user/pen/ID)`; the result view is shown.
  - Once zoomed, "Open in new tab" is at the top right. The page runs in an isolated frame and cannot reach your folder or the site's data; pages from other sites are not supported.
  - After you click into the page the keyboard goes with it; click outside the page and the arrow keys control the deck again. In an exported single HTML file, `.html` files from the folder cannot play.
- Prefer online video; compress local video to 1080p and under 100 MB per file.
- An image inside a paragraph (not on its own line) is shown inline.
- **Several images side by side**: two or more images on their own lines become a `gallery` automatically (2–3 per row, 4 as 2×2, 5–6 in three columns, up to 8).
- **Screenshot highlights**: write `<!-- mark: left top width height label -->` at the top of the slide to draw a red box with a label on the main image; the four numbers are percentages of the image (0–100), and you can add several lines. Put `#hex` before the label to change its color, e.g. `<!-- mark: 10 40 30 20 #1e88e5 The fix -->`. No need to work out coordinates: **drag on the image in the editor preview** and the line is inserted for you. Highlighted images are shown whole (not cropped). Other Markdown apps treat the lines as invisible comments.

### Footnotes

Write `[^1]` next to the text, and put `[^1]: text` on a line of its own anywhere in the file. Numbers follow the order of first reference, and the definitions appear in small text at the end of the slide content. The checker warns about markers without a definition.

```markdown
Revenue grew 35%[^1]

[^1]: Q3 2026 earnings report
```

### Code highlighting

Tag a code block with its language to highlight it: `js`, `ts`, `python`, `json`, `bash` or `sql` (other languages are shown as plain text).

### Sources, data dates and footers

When you quote numbers, follow these three rules and the slide formats them as professional footers:

1. **Put the source next to the number.** A paragraph starting with `Source:`, `Sources:`, `Data as of` (or the Chinese `資料來源:`, `來源:`, `資料截至`, `註:`) becomes small footer text.
2. **Date your data in time-sensitive decks.** Put "Data as of Nov 6, 2026 close" in the `kicker` of `deck.yml`; it appears on the title slide.
3. **End with a "Sources" slide.** List every source as a link so the audience can photograph and check them.

```markdown
## NT$994.3 billion

Foreign investors sold a record NT$994.3 billion of Taiwan shares in October.

Source: Economic Daily News, Nov 6, 2026
```

Values derived from other numbers (for example the difference of two closing prices) must say "derived" in the footer.

---

## 5. Layouts

When `layout` is omitted it is `auto`:

- Two or more media items → `gallery`
- One media item and no text → `full`
- A quote plus one photo → `quote` (quote with portrait)
- Text plus media → `split`
- Only a quote → `quote`
- The first line is a short `## number` and there are at most 3 lines → `number`
- Anything else → `text`

| Layout | Use | How to write it |
|---|---|---|
| `text` | Normal content | Heading plus list or paragraphs |
| `center` | Centered emphasis | Same as text, centered both ways |
| `split` | Text left, media right | Text plus a media line |
| `split-left` | Media left, text right | Same as split |
| `full` | Full-bleed image or video | Media only; any text is overlaid at the bottom |
| `quote` | Quotation | `> quote`, then `— source` on the next line; add a photo on its own line for a portrait on the right that fades into the slide |
| `number` | Big number | `## 68%`, then an explanation |
| `stats` | Stat cards (2–4) | List items written as `- **68%** label`; long values shrink automatically, keep them under 8 characters |
| `timeline` | Timeline or steps | `- **2024** event`; sub-items become small text; end an item with `(now)` to mark the current point |
| `columns` | Side-by-side comparison | Separate columns with `+++` on its own line; a first part with only a heading becomes the slide title |
| `agenda` | Automatic agenda | Lists every section; nothing to write |
| `chart` | Chart | Write a table: first column labels, other columns values; `chart: bar / hbar / line`, `unit: pts`. Values may use thousands separators, minus signs (− or -), % and units; write missing values as `—`, `N/A` or leave them blank |
| `flow` | Flow chart | Each list is a row, with arrows drawn between items. A line on its own just before a list labels that row (a fully bold line = accent label); a fully bold item = accent box; an indented line under an item = line break in the box; indented sub-items = small boxes under it. 3–6 items per row work best |
| `grid` | Grid of blocks (card layouts like presentation software) | Like `columns`, separated by `+++` lines, wrapping automatically: 2–3 per row, 4 as 2×2, 5–6 as 3×2, 7–8 as 4×2. A first part with only a heading becomes the slide title; images on their own line stay inside their block |
| `gallery` | Images side by side | A heading plus two or more images on their own lines; `ratio: 2:1` adjusts column widths |
| `end` | Closing slide | `# Thank you` plus contact details |
| `title`, `section` | Automatic title slide and section covers | Usually not written by hand |

Examples:

```markdown
<!-- layout: stats -->
# This year's results
- **3×** user growth
- **12 min** average preparation time
- **98%** satisfaction
Source: 2026 internal survey
```

```markdown
---
layout: chart
chart: bar
unit: k
---
# Quarterly revenue
| Quarter | 2025 | 2026 |
|---|---|---|
| Q1 | 120 | 150 |
| Q2 | 135 | 180 |
```

See `content/00-官方範例/04-Feature-Tour/` (English) and `content/00-官方範例/01-功能總覽/` (Chinese) for every layout.

---

## 6. Principles of a good deck

These are not syntax rules; they are what makes a deck look professional:

1. **One idea per slide.** Write the conclusion as the heading ("Growth came from new customers"), not just the topic ("Revenue analysis").
2. **At most 5 bullets, each at most a line and a half.** Split the slide if it does not fit.
3. **Slide count follows talk length** (including the automatic title slide and section covers):

   | Length | Slides | Sections |
   |---|---|---|
   | 5 minutes | 6–8 | 1–2 |
   | 10 minutes | 10–13 | 2–3 |
   | 15 minutes | 14–18 | 3 |
   | 25–30 minutes | 20–30 | 3–5 |

   The checker warns above 45 slides.
4. **Numbers need sources.** Never invent data; label illustrative numbers clearly as illustrative.
5. **3–7 slides per section.** Sections are signposts for the audience; start with an `agenda`.
6. **Avoid wall-to-wall text.** Every 3–4 slides, add a `number`, `quote`, `full` or chart slide to vary the rhythm.
7. **Put details in the notes.** Slides are for the audience, notes are for you.
8. **End with an action.** Put "Next steps" or "Conclusion" before the last slide, not just "Thank you".
9. **Add a disclaimer on sensitive topics.** For investment, medical or legal decks, state on the conclusion slide that it is not investment (medical, legal) advice.

---

## 7. Workflow for AI

### Confirm first

- Topic, audience, length, and which topic folder the deck goes in.
- Available material (images, data, video URLs). **Do not invent numbers** when there is no data.

### When you receive data or sources

1. **Build a number table first** (in your working notes, not in the deck): every number maps to one source and one date.
2. Numbers may come only from material the user gave you or from source pages you actually opened; search-result snippets do not count.
3. When sources disagree, prefer the more primary one (official announcement > major media > blogs) and explain in the notes.
4. Mark derived numbers as "derived"; when comparisons use different dates, state the date ("as of Nov 4").

### Steps

1. Choose the deck folder name: `YYYY-MM-short-name`, inside the right topic. Inside the repository, `node scripts/new-deck.mjs <folder> --title "Title"` creates `deck.yml`, three sections and starter slides in one go; then rewrite the content.
2. Write `deck.yml` first: `mdslide: 1`, `title`, `subtitle`, `date`, `theme`, `lang`, `kicker` (with the data date for current events), `cover_notes`, and `sections` with title, color and `notes` for each section.
3. Plan sections and slides per section using the table in section 6.
4. One file per slide: `01-xxx.md`; add front matter only when needed.
5. Use at least 4 different layouts; put an `agenda` in the first section.
6. Write `Note:` speaker notes for every slide (what to say, where to pause, what to ask); cite quoted numbers in the notes.
7. Media always uses `media/` paths or online URLs; never reference files that do not exist.
8. Run the check (all three give the same result; pick one):

```bash
node scripts/check.mjs <deck-or-library-folder> --slides --lang en   # inside the repository
node mdslide-check.mjs <deck-or-library-folder> --slides --lang en   # the single-file tool in a library
```

If no command line is available, ask the user to open the folder on the website, press "✓ Check" and paste the result back.

### When no layout fits: make a small HTML file

When the built-in layouts and settings can't express something (a flow chart, an architecture diagram, an interactive calculator, a special infographic), put an `.html` file in `media/` and embed it on its own line with `![caption](media/xxx.html)` (see "Interactive pages" in section 4). It runs in an isolated frame and can't reach the user's folder.

- **Built-in layouts first.** Only make HTML when no layout can do it; text, lists, tables and ordinary charts never need it.
- **One file.** Put the CSS and JavaScript inside the HTML; don't reference other files.
- **No network.** No external fonts, libraries or images; it must work offline.
- **Fit 16:9.** Design for 1280×720, use relative units, text at least 20px; transparent background or the deck theme's colors.
- **Store nothing.** No localStorage or cookies, no forms that submit anywhere.
- **Clear file names**, e.g. `media/flow-rollout.html`; explain in the speaker notes how to use it.
- **Know the limits.** In the pile and thumbnails it shows only a placeholder and runs when the slide is zoomed; exported single HTML files can't play it. Keep the key message in the slide text or notes, not only inside the HTML.

### Acceptance checklist

- [ ] The check reports "✓ No problems found"
- [ ] Every slide heading is a conclusion
- [ ] No list longer than 5 items, no invented numbers
- [ ] Every section has a title and color; section and slide counts fit the talk length
- [ ] Nothing runs past the slide (the editor preview and the player's Check warn about it; split the slide or use `size: small`)
- [ ] No empty slides (settings but no content; the checker warns about them)
- [ ] Every slide has speaker notes (the checker shows note coverage)
- [ ] Every slide with numbers has a "Source:" footer, and the deck ends with a sources slide
- [ ] Time-sensitive decks date their data in `kicker`; sensitive topics have a disclaimer
- [ ] Media paths are correct and online videos are publicly viewable
- [ ] Any custom HTML file is a single file with no network access

### Ready-to-use prompt

```text
Please read docs/GUIDE.en.md in full first.
Make a deck in the "<topic folder>" folder:
- Topic: <topic>
- Audience: <audience>
- Length: <minutes> minutes
- Material: <data, images, video URLs, or "none">
Follow the steps in section 7 of the guide to create the folder and files, then run check.mjs and report the result.
```

---

## 8. FAQ

- **Wrong order on screen?** Check the number prefixes. They sort numerically (`2-` before `10-`), but two digits (`02-`) also keep file explorers in the same order. The checker warns about duplicate prefixes and mixed widths at the same level.
- **Can I edit the content on the site?** Yes. Zoom into a slide and press `E` (or "Edit" in the toolbar): Markdown on the left, live preview on the right, `Ctrl+S` saves back to the file in your folder (needs a local folder opened in Chrome / Edge; the browser asks once for permission to write). The toolbar picks a layout and inserts headings, lists, images or videos, columns, a new slide and notes, so you don't need to remember the syntax; the "Look ▾" panel sets text size, background color or image, overlay, accent and text colors, font, alignment, column ratio, step reveal, hiding and the footer by choosing from menus (written as settings comments at the top of the slide); `‹` `›` (or `Alt+PageUp` / `Alt+PageDown`) move to the previous or next slide and save first when switching files.
  - The toolbar also has "+ New slide" (numbering continues automatically) and "Archive", which moves the file to `_封存/` inside the deck folder — **it is not deleted** and you can move it back yourself.
  - Automatic cover and section pages have no file of their own, so `E` edits `deck.yml` instead.
  - If another program changes the file while you are editing, you are asked which version to keep before anything is overwritten.
  - The presenter view (`S`) can edit the current slide's notes directly; the deck reloads after saving.
  - Other browsers and the built-in library cannot save: "Save" downloads the edited file instead, and the built-in library also offers "Edit on GitHub".
- **How do I see my edits?** Folders opened in Chrome / Edge update automatically (within about 1.5 seconds), or press `R`. In other browsers, choose the folder again.
- **A slide is missing?** Does its file name start with `_`? Does its front matter say `hidden: true`?
- **"Media not found"?** Paths are relative to the deck folder, for example `media/a.jpg`, and letter case must match.
- **A config file has no effect?** Indent with spaces and put a space after each colon; "✓ Check" on the website shows the line with the problem.
- **USB drive on another computer?** Open the website in Chrome or Edge and choose the folder again.
- **Sending the deck to someone, or presenting on a computer without internet?** In the player, click "Export" at the top right to download one `.html` file. It contains the player, styles, slides and images; double-click it to present offline (the pile animation and presenter view still work). Local video and audio are left out by default because they make the file large; tick the box in the dialog to include them. Online videos such as YouTube still need a connection.
- **Part of a chart is cropped?** While presenting, click the image to see all of it. To show it uncropped on the slide itself, add `fit: contain` to that slide's settings (see section 5); this suits charts and screenshots.
- **Want to mark something up while presenting?** Zoom into a slide and press `D` (or ✎ in the toolbar). The default is a laser pointer whose strokes fade out together after you stop; you can also pick a pen, highlighter or eraser. You can draw in the presenter view (`S`) too, and it appears on the audience screen.
- **Sharing with people who missed the talk?** Press `M` (or "Read" in the toolbar) for the reading view: the whole deck on one scrolling page, with speaker notes under each slide. The link then ends in `/read`, so you can share it directly; "Print handout" prints an A4 handout with the notes. Write fuller speaker notes and readers will follow along too.
