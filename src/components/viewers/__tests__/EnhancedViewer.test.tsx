import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EnhancedViewer } from "../EnhancedViewer";
import { useStore } from "@/store";

// Mock all sub-views as simple stubs
vi.mock("../MarkdownViewer", () => ({
  MarkdownViewer: () => <div data-testid="markdown-viewer">MarkdownViewer</div>,
}));
vi.mock("../SourceView", () => ({
  SourceView: () => <div data-testid="source-view">SourceView</div>,
}));
vi.mock("../JsonTreeView", () => ({
  JsonTreeView: ({ content }: { content: string }) => {
    // Parse to show key count
    try {
      const parsed = JSON.parse(content);
      const keys = Object.keys(parsed).length;
      return <div data-testid="json-tree">{keys} key{keys !== 1 ? "s" : ""}</div>;
    } catch {
      return <div data-testid="json-tree">Invalid JSON</div>;
    }
  },
}));
vi.mock("../CsvTableView", () => ({
  CsvTableView: () => <div data-testid="csv-table">CsvTableView</div>,
}));
vi.mock("../HtmlPreviewView", () => ({
  HtmlPreviewView: () => <div data-testid="html-preview">HtmlPreviewView</div>,
}));
vi.mock("../MermaidView", () => ({
  MermaidView: () => <div data-testid="mermaid-view">MermaidView</div>,
}));
vi.mock("../KqlPlanView", () => ({
  KqlPlanView: () => <div data-testid="kql-plan">KqlPlanView</div>,
}));
vi.mock("@/logger");

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
});

describe("EnhancedViewer", () => {
  it("shows ViewerToolbar for JSON files", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("shows toolbar with only wrap button for plain text files", () => {
    render(<EnhancedViewer content="hello" path="/test.txt" filePath="/test.txt" />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /source/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /visual/i })).toBeNull();
    expect(screen.getByRole("button", { name: /wrap/i })).toBeInTheDocument();
  });

  it("defaults to visual view for JSON", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    expect(screen.getByTestId("json-tree")).toBeInTheDocument();
    expect(screen.getByText("1 key")).toBeInTheDocument();
  });

  it("toggles to source view", () => {
    render(<EnhancedViewer content='{"a":1}' path="/test.json" filePath="/test.json" />);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(screen.getByTestId("source-view")).toBeInTheDocument();
    expect(screen.queryByTestId("json-tree")).toBeNull();
  });

  it("defaults to visual view for markdown", () => {
    render(<EnhancedViewer content="# Hello" path="/test.md" filePath="/test.md" />);
    expect(screen.getByTestId("markdown-viewer")).toBeInTheDocument();
  });

  it("defaults to source view for HTML", () => {
    render(<EnhancedViewer content="<h1>hi</h1>" path="/test.html" filePath="/test.html" />);
    expect(screen.getByTestId("source-view")).toBeInTheDocument();
  });

  it("shows source view for plain text with wrap toggle", () => {
    render(<EnhancedViewer content="hello" path="/test.txt" filePath="/test.txt" />);
    expect(screen.getByTestId("source-view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wrap/i })).toBeInTheDocument();
  });
});
