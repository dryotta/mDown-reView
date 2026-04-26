# React 19 APIs

New and changed React 19 APIs to prefer, plus the legacy patterns they replace.

> **Source:** distilled verbatim from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) -- `composition-patterns` section 4 and `react-best-practices` section 8 (MIT, (c) Vercel). Rule IDs preserved verbatim. Reproduced under MIT -- see [LICENSE-vercel-skills.md](../LICENSE-vercel-skills.md).

## Cheat sheet

| Old (<= 18) | New (19) | Use when |
|---|---|---|
| `forwardRef(Component)` | `ref` as a regular prop | Always -- the new form is strictly simpler. |
| `useContext(Ctx)` | `use(Ctx)` | Always -- `use` is legal in conditionals/loops. |
| `useEffect` to read a Promise | `use(promise)` inside `<Suspense>` | Data-fetching components rendered under Suspense. |
| Manual optimistic state | `useOptimistic(state, reducer)` | Form submissions, comment posting. |
| Manual `pending` flag | `useTransition()` | Any "this update may be slow" path -- see [rerender-optimization.md](rerender-optimization.md) `rerender-transitions`. |
| `<link rel="preload">` | `preload`/`preinit`/`prefetchDNS` from `react-dom` | Resource hints discoverable at render time -- see [rendering-performance.md](rendering-performance.md) `rendering-resource-hints`. |

## Rules from composition-patterns

### `react19-no-forwardref` -- React 19 API Changes

**Impact: MEDIUM (cleaner component definitions and context usage)**

> **⚠️ React 19+ only.** Skip this if you're on React 18 or earlier.

In React 19, `ref` is now a regular prop (no `forwardRef` wrapper needed), and `use()` replaces `useContext()`.

**Incorrect: forwardRef in React 19**

```tsx
const ComposerInput = forwardRef<TextInput, Props>((props, ref) => {
  return <TextInput ref={ref} {...props} />
})
```

**Correct: ref as a regular prop**

```tsx
function ComposerInput({ ref, ...props }: Props & { ref?: React.Ref<TextInput> }) {
  return <TextInput ref={ref} {...props} />
}
```

**Incorrect: useContext in React 19**

```tsx
const value = useContext(MyContext)
```

**Correct: use instead of useContext**

```tsx
const value = use(MyContext)
```

`use()` can also be called conditionally, unlike `useContext()`.


## Rules from react-best-practices section 8 (Advanced Patterns)

### `advanced-effect-event-deps` -- Do Not Put Effect Events in Dependency Arrays

**Impact: LOW (avoids unnecessary effect re-runs and lint errors)**

Effect Event functions do not have a stable identity. Their identity intentionally changes on every render. Do not include the function returned by `useEffectEvent` in a `useEffect` dependency array. Keep the actual reactive values as dependencies and call the Effect Event from inside the effect body or subscriptions created by that effect.

**Incorrect: Effect Event added as a dependency**

```tsx
import { useEffect, useEffectEvent } from 'react'

function ChatRoom({ roomId, onConnected }: {
  roomId: string
  onConnected: () => void
}) {
  const handleConnected = useEffectEvent(onConnected)

  useEffect(() => {
    const connection = createConnection(roomId)
    connection.on('connected', handleConnected)
    connection.connect()

    return () => connection.disconnect()
  }, [roomId, handleConnected])
}
```

Including the Effect Event in dependencies makes the effect re-run every render and triggers the React Hooks lint rule.

**Correct: depend on reactive values, not the Effect Event**

```tsx
import { useEffect, useEffectEvent } from 'react'

function ChatRoom({ roomId, onConnected }: {
  roomId: string
  onConnected: () => void
}) {
  const handleConnected = useEffectEvent(onConnected)

  useEffect(() => {
    const connection = createConnection(roomId)
    connection.on('connected', handleConnected)
    connection.connect()

    return () => connection.disconnect()
  }, [roomId])
}
```

Reference: [https://react.dev/reference/react/useEffectEvent#effect-event-in-deps](https://react.dev/reference/react/useEffectEvent#effect-event-in-deps)

### `advanced-init-once` -- Initialize App Once, Not Per Mount

**Impact: LOW-MEDIUM (avoids duplicate init in development)**

Do not put app-wide initialization that must run once per app load inside `useEffect([])` of a component. Components can remount and effects will re-run. Use a module-level guard or top-level init in the entry module instead.

**Incorrect: runs twice in dev, re-runs on remount**

```tsx
function Comp() {
  useEffect(() => {
    loadFromStorage()
    checkAuthToken()
  }, [])

  // ...
}
```

**Correct: once per app load**

```tsx
let didInit = false

function Comp() {
  useEffect(() => {
    if (didInit) return
    didInit = true
    loadFromStorage()
    checkAuthToken()
  }, [])

  // ...
}
```

Reference: [https://react.dev/learn/you-might-not-need-an-effect#initializing-the-application](https://react.dev/learn/you-might-not-need-an-effect#initializing-the-application)

### `advanced-event-handler-refs` -- Store Event Handlers in Refs

**Impact: LOW (stable subscriptions)**

Store callbacks in refs when used in effects that shouldn't re-subscribe on callback changes.

**Incorrect: re-subscribes on every render**

```tsx
function useWindowEvent(event: string, handler: (e) => void) {
  useEffect(() => {
    window.addEventListener(event, handler)
    return () => window.removeEventListener(event, handler)
  }, [event, handler])
}
```

**Correct: stable subscription**

```tsx
import { useEffectEvent } from 'react'

function useWindowEvent(event: string, handler: (e) => void) {
  const onEvent = useEffectEvent(handler)

  useEffect(() => {
    window.addEventListener(event, onEvent)
    return () => window.removeEventListener(event, onEvent)
  }, [event])
}
```

**Alternative: use `useEffectEvent` if you're on latest React:**

`useEffectEvent` provides a cleaner API for the same pattern: it creates a stable function reference that always calls the latest version of the handler.

### `advanced-use-latest` -- useEffectEvent for Stable Callback Refs

**Impact: LOW (prevents effect re-runs)**

Access latest values in callbacks without adding them to dependency arrays. Prevents effect re-runs while avoiding stale closures.

**Incorrect: effect re-runs on every callback change**

```tsx
function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => onSearch(query), 300)
    return () => clearTimeout(timeout)
  }, [query, onSearch])
}
```

**Correct: using React's useEffectEvent**

```tsx
import { useEffectEvent } from 'react';

function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')
  const onSearchEvent = useEffectEvent(onSearch)

  useEffect(() => {
    const timeout = setTimeout(() => onSearchEvent(query), 300)
    return () => clearTimeout(timeout)
  }, [query])
}
```
