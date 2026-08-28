import path from "node:path";

export const APP_PROTOCOL = "shiftc";
export const APP_HOST = "app";

/**
 * `shiftc://app/<asset>` をrenderer配布ディレクトリ配下のファイルに限定して解決する。
 * URLデコード後に正規化し、`..` を使ったディレクトリ外アクセスを必ず拒否する。
 */
export function resolveRendererAssetPath(rendererDir: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== `${APP_PROTOCOL}:` || url.hostname !== APP_HOST)
    throw new Error("許可されていないアプリ内URLです");

  const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "") || "index.html";
  const root = path.resolve(rendererDir);
  const resolved = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot))
    throw new Error("アプリ配布ディレクトリ外のファイルにはアクセスできません");
  return resolved;
}

export const rendererEntryUrl = () => `${APP_PROTOCOL}://${APP_HOST}/index.html`;
