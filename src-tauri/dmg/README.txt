mdownreview

1. Drag mdownreview into the Applications folder.

2. First launch — clear the macOS quarantine attribute once. Open Terminal
   and run:

       xattr -d com.apple.quarantine /Applications/mdownreview.app

   Then double-click mdownreview in Applications.

   Alternative: open mdownreview from Applications, accept the block, then
   go to System Settings → Privacy & Security → "Open Anyway".

   (On macOS Sequoia 15+ the older context-menu Open shortcut no longer
   bypasses the warning — use one of the two options above.)

See https://dryotta.github.io/mdownreview/ for the full unsigned-app
explainer.
