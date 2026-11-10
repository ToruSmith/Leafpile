# Footnotes and code highlighting

- Add a footnote marker next to a number[^1]; numbering is automatic
- Tag a code block with its language and it is highlighted[^2]

```python
# Read a deck and print its title
deck = load_deck("talk")
print(deck.title, 42)
```

[^1]: Put definitions anywhere in the file as [^id]: text
[^2]: Supports js, ts, python, json, bash and sql

Note:
Footnote definitions are collected at the end of the content; the checker warns about markers without a definition.
