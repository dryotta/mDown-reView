/**
 * Vitest auto-mock for `@/lib/tauri-events`.
 *
 * Picked up by Vitest's sibling `__mocks__` convention when test files
 * call `vi.mock("@/lib/tauri-events")` WITHOUT a factory. Test files
 * that supply their own factory (when they need bus-style coordination)
 * MUST export every member used in production paths they render — see
 * `src/__tests__/event-fixture-conformance.test.ts` for the AST scanner
 * that enforces this. The shared file here ensures the "default" path
 * stays in lockstep with the production module's exported surface.
 *
 * Returns no-op subscriptions: every `listen*` resolves to an unlisten
 * function so component-mount paths don't hang waiting on Tauri's
 * runtime.
 */
import { vi } from "vitest";

export const listenEvent = vi.fn(() => Promise.resolve(() => {}));
export const listenDragDrop = vi.fn(() => Promise.resolve(() => {}));

// Type-only re-export — preserves type-import surface for consumers
// (e.g. `import type { DragDropEvent } from "@/lib/tauri-events"`).
export type {
  DragDropEvent,
  EventName,
  EventPayloads,
  UnlistenFn,
} from "../tauri-events";
