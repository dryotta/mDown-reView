# Flow Schema

Each flow in `catalogue.md` is a fenced YAML block under an `## <id>` heading.

```yaml
id: comment-add               # kebab-case unique id
name: Add a comment           # human title
priority: 1                   # 1 = always run, 2 = if budget, 3 = opportunistic
preconditions:
  - one file is open in a tab
steps:
  - { kind: click, selector: "button[aria-label='Add comment']" }
  - { kind: type,  selector: "textarea[name='comment']", text: "explore-ux probe" }
  - { kind: click, selector: "button[type='submit']" }
success_signal:
  selector: ".comment-thread .comment:last-child"
recovery:
  - { kind: press, key: "Escape" }
```

Step kinds: `click`, `type`, `press`, `hover`, `goto`, `wait`, `resize`.
