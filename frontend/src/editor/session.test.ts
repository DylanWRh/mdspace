import { describe, expect, it } from "vitest";

import { EditingSession } from "./session";

describe("EditingSession", () => {
  it("tracks dirty and saved Markdown independently of the representation", () => {
    const session = new EditingSession();
    session.start({ path: "notes/a.md", workspace: "/notes", version: "v1", source: "# A\n" });
    session.update("# B\n");
    session.switchRepresentation("source");

    expect(session.snapshot.status).toBe("dirty");
    expect(session.snapshot.representation).toBe("source");

    session.beginSave();
    expect(session.snapshot.status).toBe("saving");
    session.saved("# B\n", "v2");
    expect(session.snapshot).toMatchObject({
      savedMarkdown: "# B\n",
      currentMarkdown: "# B\n",
      version: "v2",
      status: "clean",
    });
  });

  it("preserves unsaved content when a save conflicts", () => {
    const session = new EditingSession();
    session.start({ path: "a.md", workspace: "/notes", version: "v1", source: "old" });
    session.update("local change");
    session.beginSave();
    session.failed("changed outside", true);

    expect(session.snapshot.status).toBe("conflict");
    expect(session.snapshot.currentMarkdown).toBe("local change");
    expect(session.snapshot.savedMarkdown).toBe("old");
  });
});
