# Public beta: tester guide

English · [繁體中文](BETA.md)

Thanks for trying Leafpile! This round asks one question: **can a first-time user get all the way around "note → deck → after-talk note"?**

About 30 minutes. Nothing to install or sign up for; your files are never uploaded.

## Before you start

- Desktop **Chrome or Edge** (other browsers can read and play but cannot save, so you won't finish the round).
- Download the [example library](https://github.com/ToruSmith/Leafpile/releases/latest) (`Leafpile-library-*.zip`) and unzip it to your desktop.
- Open <https://torusmith.github.io/Leafpile/>, click **Open a local folder**, pick the unzipped folder, and choose **Allow** when the browser asks.

If you're stuck for more than 3 minutes, move on and note where you got stuck. **Getting stuck is the most useful feedback.**

## Seven steps

1. **Write a note**: On the “My library” page, click **+ Note** next to the search box (if you only see “Read-only”, the library has no write access: go back to the home page, click “Open a local folder” again and choose **Allow**). Topic “讀書筆記” (reading notes). Add a title, two or three `##` headings, and a few lines under each. Type `[[` in the text and link to the note “歡迎使用 Leafpile” (the welcome note). Save with Ctrl+S.
2. **Flash play**: on your note, click **▶ Flash play** (or press P), page through with the arrow keys, press Esc to come back. Nothing is written to disk.
3. **Make it a deck**: on the note, click **Make a deck**. A new deck is created under `slides/` and opened. Press E, change the text of one slide, save.
4. **Rehearse**: in the deck, press S to open the presenter view (allow the pop-up if the browser blocks it). In the presenter view press **Q** and record two pretend audience questions; answer one of them.
5. **After-talk note**: back in the deck, press Ctrl+K (⌘K on Mac) and choose **Save this deck as an after-talk note**. Open the new note and check that your Q&A is in it.
6. **(Optional) Source reminder**: add a sentence to the note from step 1, save, and open the deck again. A "source note changed" reminder appears at the bottom right with **Open source note** and **Caught up, stop reminding** buttons (missed it? Ctrl+K → **Mark the deck as caught up with its source note**).
7. **Report**: fill in the [beta feedback form](https://github.com/ToruSmith/Leafpile/issues/new?template=beta-feedback.yml) (needs a GitHub account). No account? Answer the form's questions in a message to whoever invited you.

## Please don't paste

Your own private notes, email addresses or phone numbers. If you need a screenshot, reproduce it with the example library.

## Not tested this round

Canvas boards, editing on phones, collaboration. They don't exist yet, so no need to report them missing.
