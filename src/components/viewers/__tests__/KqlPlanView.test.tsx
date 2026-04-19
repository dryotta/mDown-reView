import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KqlPlanView } from "../KqlPlanView";

describe("KqlPlanView", () => {
  it("renders formatted query and operator table", () => {
    render(<KqlPlanView content="Events | where Level == 'Error' | summarize count() by Source" />);
    expect(screen.getAllByText("where").length).toBeGreaterThan(0);
    expect(screen.getAllByText("summarize").length).toBeGreaterThan(0);
    expect(screen.getByText(/3 operators/)).toBeInTheDocument();
  });

  it("handles empty content", () => {
    render(<KqlPlanView content="" />);
    expect(screen.getByText(/no query/i)).toBeInTheDocument();
  });
});
