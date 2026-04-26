# React Rendering Performance

Patterns that reduce paint cost, layout thrash, and hydration glitches.

> **Source:** distilled verbatim from [vercel-labs/agent-skills/skills/react-best-practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) (MIT, (c) Vercel). Rule IDs preserved verbatim. Reproduced under MIT -- see [LICENSE-vercel-skills.md](../LICENSE-vercel-skills.md).

## Rules

### `rendering-animate-svg-wrapper` -- Animate SVG Wrapper Instead of SVG Element

**Impact: LOW (enables hardware acceleration)**

Many browsers don't have hardware acceleration for CSS3 animations on SVG elements. Wrap SVG in a `<div>` and animate the wrapper instead.

**Incorrect: animating SVG directly - no hardware acceleration**

```tsx
function LoadingSpinner() {
  return (
    <svg 
      className="animate-spin"
      width="24" 
      height="24" 
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" />
    </svg>
  )
}
```

**Correct: animating wrapper div - hardware accelerated**

```tsx
function LoadingSpinner() {
  return (
    <div className="animate-spin">
      <svg 
        width="24" 
        height="24" 
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" />
      </svg>
    </div>
  )
}
```

This applies to all CSS transforms and transitions (`transform`, `opacity`, `translate`, `scale`, `rotate`). The wrapper div allows browsers to use GPU acceleration for smoother animations.

### `rendering-content-visibility` -- CSS content-visibility for Long Lists

**Impact: HIGH (faster initial render)**

Apply `content-visibility: auto` to defer off-screen rendering.

**CSS:**

```css
.message-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
```

**Example:**

```tsx
function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="overflow-y-auto h-screen">
      {messages.map(msg => (
        <div key={msg.id} className="message-item">
          <Avatar user={msg.author} />
          <div>{msg.content}</div>
        </div>
      ))}
    </div>
  )
}
```

For 1000 messages, browser skips layout/paint for ~990 off-screen items (10× faster initial render).

### `rendering-hoist-jsx` -- Hoist Static JSX Elements

**Impact: LOW (avoids re-creation)**

Extract static JSX outside components to avoid re-creation.

**Incorrect: recreates element every render**

```tsx
function LoadingSkeleton() {
  return <div className="animate-pulse h-20 bg-gray-200" />
}

function Container() {
  return (
    <div>
      {loading && <LoadingSkeleton />}
    </div>
  )
}
```

**Correct: reuses same element**

```tsx
const loadingSkeleton = (
  <div className="animate-pulse h-20 bg-gray-200" />
)

function Container() {
  return (
    <div>
      {loading && loadingSkeleton}
    </div>
  )
}
```

This is especially helpful for large and static SVG nodes, which can be expensive to recreate on every render.

**Note:** If your project has [React Compiler](https://react.dev/learn/react-compiler) enabled, the compiler automatically hoists static JSX elements and optimizes component re-renders, making manual hoisting unnecessary.

### `rendering-svg-precision` -- Optimize SVG Precision

**Impact: LOW (reduces file size)**

Reduce SVG coordinate precision to decrease file size. The optimal precision depends on the viewBox size, but in general reducing precision should be considered.

**Incorrect: excessive precision**

```svg
<path d="M 10.293847 20.847362 L 30.938472 40.192837" />
```

**Correct: 1 decimal place**

```svg
<path d="M 10.3 20.8 L 30.9 40.2" />
```

**Automate with SVGO:**

```bash
npx svgo --precision=1 --multipass icon.svg
```

### `rendering-hydration-no-flicker` -- Prevent Hydration Mismatch Without Flickering

**Impact: MEDIUM (avoids visual flicker and hydration errors)**

When rendering content that depends on client-side storage (localStorage, cookies), avoid both SSR breakage and post-hydration flickering by injecting a synchronous script that updates the DOM before React hydrates.

**Incorrect: breaks SSR**

```tsx
function ThemeWrapper({ children }: { children: ReactNode }) {
  // localStorage is not available on server - throws error
  const theme = localStorage.getItem('theme') || 'light'
  
  return (
    <div className={theme}>
      {children}
    </div>
  )
}
```

Server-side rendering will fail because `localStorage` is undefined.

**Incorrect: visual flickering**

```tsx
function ThemeWrapper({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState('light')
  
  useEffect(() => {
    // Runs after hydration - causes visible flash
    const stored = localStorage.getItem('theme')
    if (stored) {
      setTheme(stored)
    }
  }, [])
  
  return (
    <div className={theme}>
      {children}
    </div>
  )
}
```

Component first renders with default value (`light`), then updates after hydration, causing a visible flash of incorrect content.

**Correct: no flicker, no hydration mismatch**

```tsx
function ThemeWrapper({ children }: { children: ReactNode }) {
  return (
    <>
      <div id="theme-wrapper">
        {children}
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var theme = localStorage.getItem('theme') || 'light';
                var el = document.getElementById('theme-wrapper');
                if (el) el.className = theme;
              } catch (e) {}
            })();
          `,
        }}
      />
    </>
  )
}
```

The inline script executes synchronously before showing the element, ensuring the DOM already has the correct value. No flickering, no hydration mismatch.

This pattern is especially useful for theme toggles, user preferences, authentication states, and any client-only data that should render immediately without flashing default values.

### `rendering-hydration-suppress-warning` -- Suppress Expected Hydration Mismatches

**Impact: LOW-MEDIUM (avoids noisy hydration warnings for known differences)**

In SSR frameworks (e.g., Next.js), some values are intentionally different on server vs client (random IDs, dates, locale/timezone formatting). For these *expected* mismatches, wrap the dynamic text in an element with `suppressHydrationWarning` to prevent noisy warnings. Do not use this to hide real bugs. Don’t overuse it.

**Incorrect: known mismatch warnings**

```tsx
function Timestamp() {
  return <span>{new Date().toLocaleString()}</span>
}
```

**Correct: suppress expected mismatch only**

```tsx
function Timestamp() {
  return (
    <span suppressHydrationWarning>
      {new Date().toLocaleString()}
    </span>
  )
}
```

### `rendering-activity` -- Use Activity Component for Show/Hide

**Impact: MEDIUM (preserves state/DOM)**

Use React's `<Activity>` to preserve state/DOM for expensive components that frequently toggle visibility.

**Usage:**

```tsx
import { Activity } from 'react'

function Dropdown({ isOpen }: Props) {
  return (
    <Activity mode={isOpen ? 'visible' : 'hidden'}>
      <ExpensiveMenu />
    </Activity>
  )
}
```

Avoids expensive re-renders and state loss.

### `rendering-script-defer-async` -- Use defer or async on Script Tags

**Impact: HIGH (eliminates render-blocking)**

Script tags without `defer` or `async` block HTML parsing while the script downloads and executes. This delays First Contentful Paint and Time to Interactive.

- **`defer`**: Downloads in parallel, executes after HTML parsing completes, maintains execution order

- **`async`**: Downloads in parallel, executes immediately when ready, no guaranteed order

Use `defer` for scripts that depend on DOM or other scripts. Use `async` for independent scripts like analytics.

**Incorrect: blocks rendering**

```tsx
export default function Document() {
  return (
    <html>
      <head>
        <script src="https://example.com/analytics.js" />
        <script src="/scripts/utils.js" />
      </head>
      <body>{/* content */}</body>
    </html>
  )
}
```

**Correct: non-blocking**

```tsx
import Script from 'next/script'

export default function Page() {
  return (
    <>
      <Script src="https://example.com/analytics.js" strategy="afterInteractive" />
      <Script src="/scripts/utils.js" strategy="beforeInteractive" />
    </>
  )
}
```

**Note:** In Next.js, prefer the `next/script` component with `strategy` prop instead of raw script tags:

Reference: [https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#defer](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#defer)

### `rendering-conditional-render` -- Use Explicit Conditional Rendering

**Impact: LOW (prevents rendering 0 or NaN)**

Use explicit ternary operators (`? :`) instead of `&&` for conditional rendering when the condition can be `0`, `NaN`, or other falsy values that render.

**Incorrect: renders "0" when count is 0**

```tsx
function Badge({ count }: { count: number }) {
  return (
    <div>
      {count && <span className="badge">{count}</span>}
    </div>
  )
}

// When count = 0, renders: <div>0</div>
// When count = 5, renders: <div><span class="badge">5</span></div>
```

**Correct: renders nothing when count is 0**

```tsx
function Badge({ count }: { count: number }) {
  return (
    <div>
      {count > 0 ? <span className="badge">{count}</span> : null}
    </div>
  )
}

// When count = 0, renders: <div></div>
// When count = 5, renders: <div><span class="badge">5</span></div>
```

### `rendering-resource-hints` -- Use React DOM Resource Hints

**Impact: HIGH (reduces load time for critical resources)**

React DOM provides APIs to hint the browser about resources it will need. These are especially useful in server components to start loading resources before the client even receives the HTML.

- **`prefetchDNS(href)`**: Resolve DNS for a domain you expect to connect to

- **`preconnect(href)`**: Establish connection (DNS + TCP + TLS) to a server

- **`preload(href, options)`**: Fetch a resource (stylesheet, font, script, image) you'll use soon

- **`preloadModule(href)`**: Fetch an ES module you'll use soon

- **`preinit(href, options)`**: Fetch and evaluate a stylesheet or script

- **`preinitModule(href)`**: Fetch and evaluate an ES module

**Example: preconnect to third-party APIs**

```tsx
import { preconnect, prefetchDNS } from 'react-dom'

export default function App() {
  prefetchDNS('https://analytics.example.com')
  preconnect('https://api.example.com')

  return <main>{/* content */}</main>
}
```

**Example: preload critical fonts and styles**

```tsx
import { preload, preinit } from 'react-dom'

export default function RootLayout({ children }) {
  // Preload font file
  preload('/fonts/inter.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })

  // Fetch and apply critical stylesheet immediately
  preinit('/styles/critical.css', { as: 'style' })

  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

**Example: preload modules for code-split routes**

```tsx
import { preloadModule, preinitModule } from 'react-dom'

function Navigation() {
  const preloadDashboard = () => {
    preloadModule('/dashboard.js', { as: 'script' })
  }

  return (
    <nav>
      <a href="/dashboard" onMouseEnter={preloadDashboard}>
        Dashboard
      </a>
    </nav>
  )
}
```

**When to use each:**

| API | Use case |

|-----|----------|

| `prefetchDNS` | Third-party domains you'll connect to later |

| `preconnect` | APIs or CDNs you'll fetch from immediately |

| `preload` | Critical resources needed for current page |

| `preloadModule` | JS modules for likely next navigation |

| `preinit` | Stylesheets/scripts that must execute early |

| `preinitModule` | ES modules that must execute early |

Reference: [https://react.dev/reference/react-dom#resource-preloading-apis](https://react.dev/reference/react-dom#resource-preloading-apis)

### `rendering-usetransition-loading` -- Use useTransition Over Manual Loading States

**Impact: LOW (reduces re-renders and improves code clarity)**

Use `useTransition` instead of manual `useState` for loading states. This provides built-in `isPending` state and automatically manages transitions.

**Incorrect: manual loading state**

```tsx
function SearchResults() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const handleSearch = async (value: string) => {
    setIsLoading(true)
    setQuery(value)
    const data = await fetchResults(value)
    setResults(data)
    setIsLoading(false)
  }

  return (
    <>
      <input onChange={(e) => handleSearch(e.target.value)} />
      {isLoading && <Spinner />}
      <ResultsList results={results} />
    </>
  )
}
```

**Correct: useTransition with built-in pending state**

```tsx
import { useTransition, useState } from 'react'

function SearchResults() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isPending, startTransition] = useTransition()

  const handleSearch = (value: string) => {
    setQuery(value) // Update input immediately
    
    startTransition(async () => {
      // Fetch and update results
      const data = await fetchResults(value)
      setResults(data)
    })
  }

  return (
    <>
      <input onChange={(e) => handleSearch(e.target.value)} />
      {isPending && <Spinner />}
      <ResultsList results={results} />
    </>
  )
}
```

**Benefits:**

- **Automatic pending state**: No need to manually manage `setIsLoading(true/false)`

- **Error resilience**: Pending state correctly resets even if the transition throws

- **Better responsiveness**: Keeps the UI responsive during updates

- **Interrupt handling**: New transitions automatically cancel pending ones

Reference: [https://react.dev/reference/react/useTransition](https://react.dev/reference/react/useTransition)
