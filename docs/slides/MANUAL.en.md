# Mdslide Pile user manual

For first-time users. No programming needed.

- **Every rule in full** (folder naming, every settings field): see the [guide](GUIDE.en.md).
- **Changing the tool's code**: see [CONTRIBUTING.md](../../CONTRIBUTING.md) and [AGENTS.md](../../AGENTS.md).
- 中文:[使用手冊.md](MANUAL.zh-Hant.md)

---

## Contents

1. [In thirty seconds](#1-in-thirty-seconds)
2. [Four ways to open a deck](#2-four-ways-to-open-a-deck)
3. [While presenting](#3-while-presenting)
4. [Your first deck](#4-your-first-deck)
5. [Editing](#5-editing)
6. [Settings cheat sheet (copy and paste)](#6-settings-cheat-sheet-copy-and-paste)
7. [Layouts](#7-layouts)
8. [Fonts](#8-fonts)
9. [Colors](#9-colors)
10. [Getting help from AI](#10-getting-help-from-ai)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. In thirty seconds

- **One folder = one deck.** Each `.md` text file in it is a slide.
- **The website is the player; the folder is the content.** Nothing is uploaded; your files stay on your computer or USB drive.
- **No manual layout.** Write the text and the layout is done for you; add settings only when you want to adjust.

---

## 2. Four ways to open a deck

| Way | How | Good for |
|---|---|---|
| **Website** | Open <https://torusmith.github.io/Mdslide-Pile/> in Chrome or Edge and choose "Open a local folder" | Everyday use; editing and saving |
| **Install as an app** | The "Install" icon at the right of the address bar | Opening it like normal software; works offline once installed |
| **Export a single HTML file** | While presenting, "Export" at the top right | Sending to others or presenting offline; double-click to play |
| **Download the project** | Run a local server in the project folder (see "Using it offline" in the README) | People changing the code |

> **Note**: a downloaded `index.html` **cannot be opened by double-clicking** (a browser security rule); you'll see an explanation instead. For offline use, install the app or use an exported HTML file.
>
> Firefox and Safari can play decks but **cannot save**, and you choose the folder again each time. Use Chrome or Edge to edit.

---

## 3. While presenting

### Keyboard

| Key | Action | Key | Action |
|---|---|---|---|
| `←` `→` | Previous / next slide | `Enter` | Zoom in / out |
| `↑` `↓` | Previous / next section | `Esc` | Zoom out; again for the library |
| `1`–`9` | Jump to section | `G` | Type a slide number to jump |
| `Home` `End` | First / last slide | `O` | Overview |
| `V` | Side by side (large slide + thumbnails) | `L` | Switch 3D stage |
| `M` | Reading view (scroll with notes) | `T` | Switch theme |
| `D` | Pen and laser pointer | `X` | Clear drawings (while the pen is on) |
| `E` | Edit this slide | `S` | Presenter view |
| `B` | Black screen (any key to return) | `F` | Full screen |
| `P` | Print / save as PDF | `K` | Play / pause local video when zoomed |
| `R` | Reload | `?` | Help |

### Mouse and phone

- Click a card to select it, click again to zoom; the wheel also turns slides.
- Click an image while presenting to see it in full.
- Phones and tablets: swipe left/right for slides, up/down for sections; a hint suggests turning the phone sideways.

### Tips for the stage

- **Presenter view (`S`)** opens a second window with this slide, the next one, notes and a timer. Drag it to your own screen.
- **Clickers** just work (they send arrow keys).
- **For people who missed it**: press `M` for reading view and share the URL, or use "Print handout" for A4 pages with notes.

---

## 4. Your first deck

### The simplest version

1. Make a folder, e.g. `my-first-deck`.
2. Inside it, create a text file `01-hello.md`:

   ```markdown
   # Hello everyone

   - Three things today
   - About 10 minutes
   ```

3. Add `02-main-point.md` and `03-wrap-up.md` the same way.
4. Open the website → "Open a local folder" → choose the folder. Done.

> Any text editor works (Notepad, VS Code, Obsidian). The `01-`, `02-` prefixes set the order and are not shown.

### Sections and a title slide

```
my-first-deck/
├─ deck.yml          ← one line is enough: title: My first deck
├─ 01-opening/       ← a folder = a section
│  └─ 01-hello.md
├─ 02-main/
│  ├─ 01-first.md
│  └─ 02-second.md
└─ media/            ← images and videos
   └─ photo.jpg
```

- With `deck.yml` you get a **title slide**; each section folder gets a **section slide**.
- Images go on **their own line**: `![caption](media/photo.jpg)`.

### Speaker notes

Put `Note:` on its own line at the end of the slide; what follows appears only in presenter view and reading view:

```markdown
# Revenue up 35%

Note:
Pause here and ask the audience to guess why.
```

---

## 5. Editing

Press `E` while presenting (or "Edit" in the toolbar). Edit on the left, see the result on the right.

### Top row

| Button | Action |
|---|---|
| `‹ Close` | Back to presenting (asks first if there are unsaved changes) |
| `‹` `Slide 3 / 30` `›` | Previous / next slide without closing. **Saves first when switching files** |
| `+ New slide` | New file in the same section, numbered automatically |
| `Archive` | Moves the file to `_封存/` (**never deleted**; move it back any time) |
| `Revert` | Discard unsaved changes |
| `Save` | Save to your folder (`Ctrl+S` too) |

### Second row: insert tools

| Button | Writes |
|---|---|
| Layout ▾ | The layout for this slide (section 7) |
| Heading | Makes the line a heading; again for a smaller one |
| Bold | Bold selection (shown in the accent color) |
| List | Turns selected lines into a list |
| Image / video ▾ | Lists files in `media/`; click to insert. Also an online video template |
| Columns | Inserts `+++` (for columns and grid layouts) |
| New slide | Inserts `---` so what follows becomes a new slide |
| Notes | Jumps to this slide's notes, or adds them |
| **Look ▾** | Opens the look panel (below) |

### Look panel

| Field | Choices |
|---|---|
| Text size | Default / Small (data-heavy) / Normal / Large / Extra large |
| Background color | Pick a color; text turns light on dark backgrounds |
| Background image | "Choose image…" from `media/` |
| Image overlay | With a background image: Dark (light text) / Light / None |
| Accent color | Color of bold text, title rules and bullets |
| Text color | Usually unnecessary |
| Font | Type a name or pick from the list |
| Alignment | Left / Center / Right |
| Column ratio | For split, columns, grid and gallery layouts, e.g. 2:1 |
| Checkboxes | Reveal step by step, skip when playing, show footer |

Each choice writes a line like `<!-- size: large -->` at the top of the slide; "Default" removes it. Everything can be undone with `Ctrl+Z`.

### Screenshot highlights

When the slide has an image, **drag on the image on the right** to draw a red box. The cursor waits where the label goes, so just type it.

### Typing helpers

| Key | Action |
|---|---|
| `Ctrl+S` | Save |
| `Tab` / `Shift+Tab` | Indent / outdent (several lines at once) |
| `Enter` in a list | Continues the list; on an empty item it ends the list |
| `Alt+PageUp` / `Alt+PageDown` | Previous / next slide |
| `Esc` | Close the editor |

### Saving is safe

- Only `.md` and `.yml` files are written.
- If another program changed the file while you were editing, you're asked which version to keep (theirs by default).
- Nothing is deleted; "Archive" moves the file into `_封存/`.
- The first save asks once for permission to write; choose "Allow".

---

## 6. Settings cheat sheet (copy and paste)

Settings can go in three places; **lower rows win**:

| Where | Applies to | Example |
|---|---|---|
| `deck.yml` | The whole deck | `size: small` |
| Front matter at the top of a file | Every slide in that file | A `---` line, the settings, another `---` line |
| The top of a slide | Just that slide | `<!-- size: small -->` |

> Settings written as `<!-- -->` are **invisible** in GitHub, Obsidian and VS Code previews, so your files stay clean Markdown.

### Layout

```markdown
<!-- layout: split -->          layout (section 7)
<!-- step: true -->             reveal list items one by one
<!-- ratio: 2:1 -->             column widths (left:right); columns can use 1:1:2
<!-- align: center -->          left / center / right
<!-- fit: contain -->           show images whole, no cropping
```

### Text and color

```markdown
<!-- size: small -->            small / normal / large / xl
<!-- color: #4f73a6 -->         accent color
<!-- text: #222222 -->          text color (usually unnecessary)
<!-- font: Noto Serif TC -->    font (must be installed)
```

### Background

```markdown
<!-- background: #1f3a5f -->            background color (text turns light on dark colors)
<!-- background: media/photo.jpg -->    background image
<!-- overlay: dark -->                  overlay on the image: dark / light / none
```

> In `deck.yml` or front matter (YAML), quote colors that start with `#`: `color: "#4f73a6"`. Inside `<!-- -->` no quotes are needed.

### Other

```markdown
<!-- footer: false -->          hide the footer
<!-- hidden: true -->           skip this slide when playing (the file stays)
<!-- title: Short title -->     title shown in presenter view and overview
<!-- mark: 10 20 30 25 Look here -->       red box on the image (percent: left top width height)
<!-- mark: 50 50 40 30 #1e88e5 Blue box --> add #hex to change the color
<!-- chart: line -->            chart type: bar / hbar / line
<!-- unit: k$ -->               chart unit
```

### Handy combinations

**Big statement on a photo**

```markdown
<!-- background: media/photo.jpg -->
<!-- overlay: dark -->
<!-- size: xl -->
<!-- align: center -->
# One sentence that says it all
```

**Three points on a dark background**

```markdown
<!-- layout: columns -->
<!-- background: #1f3a5f -->
<!-- align: center -->
# Three changes

+++
### Speed
**Prototype in 3 days**
+++
### Cost
**Half**
+++
### Quality
**Fewer errors**
```

**A table with lots of data**

```markdown
<!-- size: small -->
# Sales by region

| Region | Q1 | Q2 | Q3 |
|---|---:|---:|---:|
| North | 120 | 135 | 150 |
```

---

## 7. Layouts

Without `layout` the tool picks one for you; most of the time you don't need to set it.

| Layout | Looks like | Minimum to write |
|---|---|---|
| `text` | Plain content | Heading plus list or paragraphs |
| `center` | Centered content | Same |
| `split` | Text left, media right | Text plus an image on its own line |
| `split-left` | Media left, text right | Same |
| `full` | Full-bleed image or video | Just the image line |
| `quote` | Quotation | `> quote`, then `— source`; add a photo for a portrait on the right |
| `number` | Big number | `## 68%`, then a line of explanation |
| `stats` | 2–4 stat cards | `- **68%** description` |
| `timeline` | Timeline | `- **2024** event`, `(now)` on the current item |
| `columns` | Side-by-side columns | Separate columns with a `+++` line |
| `grid` | Grid of blocks (2×2, 3×2 cards) | Like columns with `+++`; blocks can hold images |
| `flow` | Flow chart | Each list is a row of boxes with arrows |
| `gallery` | Images side by side | Two or more image lines |
| `chart` | Bar or line chart | A table |
| `agenda` | Automatic agenda | Nothing |
| `end` | Closing slide | `# Thank you` |

### Example: `grid`

```markdown
<!-- layout: grid -->
# Four blocks on one slide

+++
### Write
![](media/a.png)
One file per slide
+++
### Arrange
Folders are sections
+++
### Present
- 3D pile
+++
### Share
- Export HTML
```

Blocks arrange themselves: 2–3 in a row, 4 as 2×2, 5–6 as 3×2, 7–8 as 4×2.

### Example: `flow`

```markdown
<!-- layout: flow -->
# How we handle email

Before
- Receive
- Reply by hand
- Send

**Now**
- Receive
  - Match the customer
- **AI draft**
- Manager approves
```

- A line on its own before a list labels the row; a fully bold line becomes a colored label.
- A fully bold item is an accent box.
- Indented sub-items become small boxes under the box; an indented plain line is a line break inside the box.

### Example: `chart`

```markdown
<!-- layout: chart -->
<!-- chart: bar -->
<!-- unit: k$ -->
# Monthly revenue

| Month | Revenue |
|---|---:|
| Jan | 120 |
| Feb | 150 |
```

More examples are in [section 5 of the guide](GUIDE.en.md#5-layouts) and in the official sample decks.

---

## 8. Fonts

### Default fonts

| Theme | Headings | Body |
|---|---|---|
| `paper`, `ink` | Serif (Noto Serif TC → Source Han Serif → PMingLiU) | Sans (Noto Sans TC → PingFang → Microsoft JhengHei) |
| `slate` | Sans | Sans |

English decks (`lang: en`) put Latin fonts first. The tool **never downloads fonts**; it uses fonts already on the computer, falling back down the list when one is missing.

### Changing fonts

| Scope | How |
|---|---|
| Whole deck | In `deck.yml` under `brand:`, `font_display: heading font` and `font_body: body font` |
| One slide | `<!-- font: Font Name -->`, or the font field in the editor's "Look ▾" panel |

- Write only the font **name**, e.g. `Noto Serif TC`, `Microsoft JhengHei`, `Georgia`. Separate several with commas; later ones are fallbacks.
- Names may contain only letters, digits, spaces, `-`, `_` and `.`.
- **The presenting computer must have the font**, otherwise the default is used. Prefer fonts available on both Windows and Mac, or install the free [Noto fonts](https://fonts.google.com/noto) beforehand.
- Exported HTML files don't include font files either.

---

## 9. Colors

### Where colors come from

In order of priority:

1. The slide's `<!-- color: ... -->`
2. The section color (`color` under `sections:` in `deck.yml`)
3. The deck accent (`accent` in `deck.yml`)
4. Automatic (one color per section)

The accent color is used for bold text, title rules, bullets, timelines, charts and card edges.

### Themes

Set `theme: paper` (warm off-white), `ink` (dark) or `slate` (white and blue-gray) in `deck.yml`. Press `T` while presenting to try them.

### Color formats

- `#4f73a6` (**recommended**; color pickers give you this), `#48a`
- `rgb(79, 115, 166)`
- CSS color names: `teal`, `navy`, `crimson`…

**Only `#hex` and `rgb()` let the tool detect brightness** (light text on dark backgrounds). With names or `hsl()` as a background, set `text` yourself.

For safety, only these formats are accepted; anything else is reported by the checker and ignored.

### Tips

- One main color per deck is enough; keep section colors in the same family.
- Pair dark backgrounds with light accents (e.g. gold `#d9a441`) and light backgrounds with deeper accents.
- Save red for warnings and mistakes.

---

## 10. Getting help from AI

### A whole deck

Give the AI the [guide](GUIDE.en.md) and your material, then say:

```text
Please read GUIDE.en.md in full first.
Make a deck for me:
- Topic: <topic>
- Audience: <audience>
- Length: <minutes> minutes
- Material: <data, images, video links, or "none">
Follow the steps in section 7 to create the folders and files, then run the checker and report the result.
```

Section 7 of the guide already tells the AI how to work: confirm the request, never invent numbers, write notes for every slide, use at least 4 layouts and pass the checker.

### The "comments" AI writes

| Syntax | What it is | Who sees it |
|---|---|---|
| Text after `Note:` | Speaker notes | Presenter view, reading view |
| `<!-- layout: ... -->` and similar | Settings for the slide | The player (other Markdown apps don't show them) |
| A paragraph starting `Source:` | Small footnote under the slide | Everyone |
| `[^1]` and `[^1]: ...` | Footnotes | Everyone |

### When no layout fits

For complex diagrams, interactive calculators or special infographics, ask the AI for a **small HTML file** in `media/` and embed it with `![caption](media/xxx.html)`. The rules are in section 7 of the guide ("When no layout fits"): one file, no network, 16:9. It runs in an isolated frame and can't reach your folder.

### Fixing one slide

```text
Here is one of my slides (paste the .md content).
Following GUIDE.en.md, change it to <what you want>.
Reply with only the updated .md content.
```

---

## 11. Troubleshooting

| Problem | What to do |
|---|---|
| Double-clicking `index.html` shows an explanation | Expected; browsers don't allow it. Use the website, the installed app or an exported HTML file |
| Wrong order | Check the number prefixes; use two digits (`01-`, `02-`) |
| A slide is missing | Does the file name start with `_`? Is there `hidden: true`? |
| "Missing media" on an image | Write `media/filename`, with matching upper/lower case |
| Text is cut off | The editor preview warns "runs past the slide"; split the slide or use `size: small` |
| Can't save | Use Chrome / Edge with "Open a local folder"; the site's built-in sample library can't be saved |
| Video won't play | Online video needs a network; local video works best as mp4, 1080p, under 100 MB |
| Changes don't show | Chrome / Edge update automatically (about 1.5 s); elsewhere press `R` or choose the folder again |
| A setting has no effect | Press "Check" in the player toolbar; it points to the mistake |

Still stuck? Open an issue on GitHub (templates provided) with a screenshot and the checker output.
