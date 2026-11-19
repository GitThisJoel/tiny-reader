import { describe, expect, it } from "vitest";
import { COMMANDS, isCommand, isCommandMessage } from "./commands.ts";

describe("commands", () => {
  it("knows its own names and nothing else", () => {
    for (const name of COMMANDS) expect(isCommand(name)).toBe(true);
    for (const value of ["read-from-here", "explode", "", 3, null, undefined]) expect(isCommand(value)).toBe(false);
  });

  it("accepts only well-formed command messages", () => {
    expect(isCommandMessage({ type: "command", name: "read" })).toBe(true);
    for (const value of [
      null,
      "read",
      {},
      { type: "command" },
      { type: "command", name: "nope" },
      { type: "x", name: "read" },
    ])
      expect(isCommandMessage(value)).toBe(false);
  });
});
