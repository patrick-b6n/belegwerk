import { beforeEach, describe, expect, it, vi } from "vitest";

const plugins = vi.hoisted(() => ({
  save: vi.fn<(options: unknown) => Promise<string | null>>(),
  writeTextFile: vi.fn<(path: string, data: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: plugins.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: plugins.writeTextFile }));

const { createTauriFileSaver } = await import("./tauri-file-saver");

const request = {
  defaultFileName: "buchungen-2025-01-01_2025-12-31.csv",
  filter: { name: "CSV-Datei", extensions: ["csv"] },
  content: "\uFEFFa;b\r\n",
} as const;

describe("createTauriFileSaver", () => {
  beforeEach(() => {
    plugins.save.mockReset();
    plugins.writeTextFile.mockReset().mockResolvedValue(undefined);
  });

  it("asks for the path and writes the content there unchanged", async () => {
    plugins.save.mockResolvedValue("C:\\Users\\x\\export.csv");
    expect(await createTauriFileSaver().saveTextFile(request)).toEqual({
      saved: true,
      path: "C:\\Users\\x\\export.csv",
    });
    expect(plugins.save).toHaveBeenCalledWith({
      defaultPath: "buchungen-2025-01-01_2025-12-31.csv",
      filters: [{ name: "CSV-Datei", extensions: ["csv"] }],
    });
    expect(plugins.writeTextFile).toHaveBeenCalledWith("C:\\Users\\x\\export.csv", request.content);
  });

  it("writes nothing when the dialog is cancelled", async () => {
    plugins.save.mockResolvedValue(null);
    expect(await createTauriFileSaver().saveTextFile(request)).toEqual({ saved: false });
    expect(plugins.writeTextFile).not.toHaveBeenCalled();
  });

  it("passes write errors on", async () => {
    plugins.save.mockResolvedValue("C:\\x.csv");
    plugins.writeTextFile.mockRejectedValue(new Error("locked"));
    await expect(createTauriFileSaver().saveTextFile(request)).rejects.toThrow("locked");
  });
});
