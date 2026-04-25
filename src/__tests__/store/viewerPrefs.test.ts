import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/index";

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("viewerPrefsSlice — remote image allowance", () => {
  it("allowRemoteImagesForDoc + isRemoteImageAllowed round-trip", () => {
    expect(useStore.getState().isRemoteImageAllowed("/doc.md")).toBe(false);
    useStore.getState().allowRemoteImagesForDoc("/doc.md");
    expect(useStore.getState().isRemoteImageAllowed("/doc.md")).toBe(true);
    expect(useStore.getState().allowedRemoteImageDocs["/doc.md"]).toBe(true);
  });

  it("allowance is per-document — allowing /a.md does not allow /b.md", () => {
    useStore.getState().allowRemoteImagesForDoc("/a.md");
    expect(useStore.getState().isRemoteImageAllowed("/a.md")).toBe(true);
    expect(useStore.getState().isRemoteImageAllowed("/b.md")).toBe(false);
  });

  it("isRemoteImageAllowed returns false for unknown documents", () => {
    expect(useStore.getState().isRemoteImageAllowed("/never-seen.md")).toBe(false);
  });
});

describe("viewerPrefsSlice — HTML preview external images", () => {
  it("setHtmlPreviewAllowExternalImages + read-back", () => {
    useStore.getState().setHtmlPreviewAllowExternalImages("/doc.html", true);
    expect(useStore.getState().htmlPreviewAllowExternalImages["/doc.html"]).toBe(true);

    useStore.getState().setHtmlPreviewAllowExternalImages("/doc.html", false);
    expect(useStore.getState().htmlPreviewAllowExternalImages["/doc.html"]).toBe(false);
  });

  it("HTML preview allowance is per-document", () => {
    useStore.getState().setHtmlPreviewAllowExternalImages("/a.html", true);
    expect(useStore.getState().htmlPreviewAllowExternalImages["/a.html"]).toBe(true);
    expect(useStore.getState().htmlPreviewAllowExternalImages["/b.html"]).toBeUndefined();
  });
});

describe("viewerPrefsSlice — persistence boundary", () => {
  it("none of the viewerPrefs keys appear in the persisted snapshot", () => {
    // Populate state so any accidental persistence would be visible.
    useStore.getState().allowRemoteImagesForDoc("/doc.md");
    useStore.getState().setHtmlPreviewAllowExternalImages("/doc.html", true);

    // Access the persist middleware's partialize via its public API.
    // `useStore.persist` is exposed by zustand's `persist` middleware.
    const persistApi = (useStore as unknown as {
      persist: { getOptions: () => { partialize?: (s: unknown) => unknown } };
    }).persist;
    const opts = persistApi.getOptions();
    expect(opts.partialize).toBeTypeOf("function");

    const snapshot = opts.partialize!(useStore.getState()) as Record<string, unknown>;

    expect(snapshot).not.toHaveProperty("allowedRemoteImageDocs");
    expect(snapshot).not.toHaveProperty("htmlPreviewAllowExternalImages");
  });
});
