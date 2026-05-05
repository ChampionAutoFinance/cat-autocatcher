# Cat Auto Catcher

Cat Auto Catcher is a Firefox extension version of the pulled `autocatcher` script.

It watches the current page for this trigger text:

```text
cat has appeared! type "cat" to catch it!
```

When running, it focuses the visible message box, inserts `cat`, and tries Enter plus a visible Send button if one exists.

## Use

1. Open Firefox with the extension loaded.
2. Open the page where the cat trigger appears.
3. Use the floating `Cat Catcher` panel to start or pause.
4. Change `Every ___ sec` to adjust the scan period.
5. Drag the panel header to move it, or drag the bottom-right corner to resize it.

Firefox treats this as a temporary local extension unless it is signed through Mozilla Add-ons.
