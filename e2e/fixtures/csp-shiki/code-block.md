# CSP Shiki regression fixture

This fixture exercises Shiki-emitted inline `style=` attributes on token spans.
The native e2e spec `e2e/native/07-csp-no-style-src-violations.spec.ts` opens
this file and asserts that no `style-src` violations are reported by the
runtime CSP enforcer.

## Code

```typescript
const greeting: string = "Hello, world!";

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

console.log(greet(greeting));
```

End of fixture.
