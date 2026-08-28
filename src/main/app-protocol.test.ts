import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PROTOCOL, resolveRendererAssetPath, rendererEntryUrl } from "./app-protocol";

describe("app protocol asset resolution", () => {
  const rendererDir = path.resolve("C:/app/renderer");

  it("resolves only assets below the renderer distribution directory", () => {
    expect(resolveRendererAssetPath(rendererDir, `${APP_PROTOCOL}://app/assets/app.js`)).toBe(
      path.resolve(rendererDir, "assets/app.js"),
    );
    expect(rendererEntryUrl()).toBe(`${APP_PROTOCOL}://app/index.html`);
  });

  it("rejects another host and traversal after URL decoding", () => {
    expect(() => resolveRendererAssetPath(rendererDir, `${APP_PROTOCOL}://other/index.html`)).toThrow();
    expect(() =>
      resolveRendererAssetPath(rendererDir, `${APP_PROTOCOL}://app/%2e%2e%2fsecret.txt`),
    ).toThrow();
  });
});
