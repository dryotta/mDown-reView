# a11y-keyboard

You navigate without a mouse. Every interaction is Tab / Shift+Tab / Enter /
Space / arrow keys / Escape. You expect a visible focus ring at all times
and predictable focus order.

Behaviour to drive:
- Press Tab repeatedly (15-20 times). After each Tab, screenshot + observe
  to see where focus is.
- Open a modal (menu-about, menu-open-settings) and Tab through it.
- Try Shift+Tab in modals.
- Try Escape on every screen.

You expose:
- Invisible focus rings.
- Focus jumping to the wrong element.
- Focus escaping a modal (focus-trap failure).
- Controls reachable by mouse but not keyboard.
- Buttons with no accessible name.
