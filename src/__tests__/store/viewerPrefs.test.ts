import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("viewerPrefsSlice — remote image allowance", () => {
  it("allowRemoteImagesForDoc sets the per-doc flag", () => {
    expect(useStore.getState().allowedRemoteImageDocs["/doc.md"]).toBeUndefined();
    useStore.getState().allowRemoteImagesForDoc("/doc.md");
    expect(useStore.getState().allowedRemoteImageDocs["/doc.md"]).toBe(true);
  });

  it("allowance is per-document — allowing /a.md does not allow /b.md", () => {
    useStore.getState().allowRemoteImagesForDoc("/a.md");
    expect(useStore.getState().allowedRemoteImageDocs["/a.md"]).toBe(true);
    expect(useStore.getState().allowedRemoteImageDocs["/b.md"]).toBeUndefined();
  });
});

describe("viewerPrefsSlice — persistence boundary", () => {
  it("allowedRemoteImageDocs never appears in the persisted snapshot", () => {
    useStore.getState().allowRemoteImagesForDoc("/doc.md");

    // Access the persist middleware's partialize via its public API.
    const persistApi = (useStore as unknown as {
      persist: { getOptions: () => { partialize?: (s: unknown) => unknown } };
    }).persist;
    const opts = persistApi.getOptions();
    expect(opts.partialize).toBeTypeOf("function");

    const snapshot = opts.partialize!(useStore.getState()) as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty("allowedRemoteImageDocs");
  });
});
