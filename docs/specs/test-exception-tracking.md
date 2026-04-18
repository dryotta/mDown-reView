# Test Exception Tracking

## Requirement: Vitest tests fail on unexpected console.error calls

The Vitest suite SHALL install a global spy on `console.error` that causes any test to fail if `console.error` is called unexpectedly. Tests that intentionally trigger errors MUST suppress the spy via `vi.mocked(console.error).mockImplementation(() => {})`.

### Scenario: Unexpected console.error fails the test
- **WHEN** a test runs and `console.error` is called without being explicitly expected
- **THEN** the test fails with a message identifying the unexpected error call

### Scenario: Expected console.error does not fail the test
- **WHEN** a test explicitly mocks `console.error` to suppress it
- **THEN** the test passes even though `console.error` was called

---

## Requirement: Vitest tests fail on unhandled promise rejections

The Vitest global setup SHALL configure the test runner to fail any test that produces an unhandled promise rejection.

### Scenario: Unhandled rejection fails the test
- **WHEN** a test creates a Promise that rejects and the rejection is not caught
- **THEN** the test fails with the rejection reason

---

## Requirement: Playwright E2E tests fail on page errors

Every Playwright E2E test SHALL attach a `pageerror` listener that collects any JavaScript errors thrown in the browser context. The test SHALL fail after its assertions if any page errors were collected.

### Scenario: JS error during E2E test fails the test
- **WHEN** a JavaScript exception is thrown in the browser during a Playwright test
- **THEN** the test fails after normal assertions, reporting the collected error

---

## Requirement: Playwright E2E tests fail on console error messages

Every Playwright E2E test SHALL collect browser `console` messages at `error` level. The test SHALL fail if any were collected, unless the message matches an explicit allowlist.

### Scenario: Console error during E2E test fails the test
- **WHEN** `console.error(...)` is called in the browser during a Playwright test
- **THEN** the test fails with the collected error message

### Scenario: Allowlisted console error does not fail the test
- **WHEN** a known, expected console error message is emitted
- **THEN** the test passes if the message matches an entry in the per-test or global allowlist

---

## Requirement: Exception tracking active across all test files

The `console.error` spy (Vitest) and `pageerror` listener (Playwright) SHALL be applied globally — no individual test file needs to opt in.

### Scenario: New test file inherits tracking
- **WHEN** a new test file is added without any exception-tracking setup code
- **THEN** the `console.error` spy and unhandled rejection detection still apply to all tests in it
