// Verify that the generated .excalidraw.png and .excalidraw.svg fixtures
// round-trip through Excalidraw's own decode logic (decodePngMetadata /
// decodeSvgBase64Payload). Run with: node samples/excalidraw/_verify.mjs
//
// We can't import the Excalidraw chunk directly in raw Node (it has
// bundler-style extension-less imports), so this script replicates the
// decode contract verbatim — same regex, same base64 path, same fallback
// branch. Source: node_modules/@excalidraw/excalidraw/dist/dev/chunk-*.js.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const MIME_EXCALIDRAW = "application/vnd.excalidraw+json";

// Mirror of Excalidraw's decodeSvgBase64Payload (Format B fallback).
function decodeSvgPayload(svg) {
  if (!svg.includes(`payload-type:${MIME_EXCALIDRAW}`)) {
    throw new Error("INVALID: missing payload-type");
  }
  const match = svg.match(/<!-- payload-start -->\s*(.+?)\s*<!-- payload-end -->/s);
  if (!match) throw new Error("INVALID: missing payload markers");
  const versionMatch = svg.match(/<!-- payload-version:(\d+) -->/);
  const version = versionMatch?.[1] || "1";
  const isByteString = version !== "1";
  // version=1 → atob; version=2 → byte-string-of-utf8 → string.
  const decoded = Buffer.from(match[1], "base64").toString(isByteString ? "binary" : "binary");
  // For ASCII payloads both paths yield the same bytes; we'll JSON-parse next.
  // (For non-ASCII + version=1, atob would diverge — we generate ASCII only.)
  const text = isByteString
    ? Buffer.from(decoded, "binary").toString("utf8")
    : decoded;
  const obj = JSON.parse(text);
  if (!("encoded" in obj) && obj.type === "excalidraw") return text;
  if ("encoded" in obj) throw new Error("Format A (deflate) not supported by this verifier");
  throw new Error("FAILED: payload not a canonical excalidraw scene");
}

// Mirror of Excalidraw's decodePngMetadata (tEXt path, Format B fallback).
// Walk PNG chunks looking for tEXt with keyword `application/vnd.excalidraw+json`.
function decodePngScene(bytes) {
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("INVALID: not a PNG");
  }
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === "tEXt") {
      const nul = data.indexOf(0);
      const keyword = data.subarray(0, nul).toString("latin1");
      const text = data.subarray(nul + 1).toString("utf8");
      if (keyword === MIME_EXCALIDRAW) {
        const obj = JSON.parse(text);
        if (!("encoded" in obj) && obj.type === "excalidraw") return text;
        if ("encoded" in obj) throw new Error("Format A (deflate) not supported by this verifier");
        throw new Error("FAILED: tEXt JSON missing type=excalidraw");
      }
    }
    offset += 8 + len + 4; // 4-byte CRC
    if (type === "IEND") break;
  }
  throw new Error("INVALID: no application/vnd.excalidraw+json tEXt chunk");
}

// SVG.
const svgText = readFileSync(resolve(here, "4-shapes.excalidraw.svg"), "utf8");
const svgPayload = decodeSvgPayload(svgText);
const svgScene = JSON.parse(svgPayload);
console.log(`[svg] ok — type=${svgScene.type} version=${svgScene.version} elements=${svgScene.elements.length}`);

// PNG.
const pngBytes = readFileSync(resolve(here, "5-shapes.excalidraw.png"));
const pngPayload = decodePngScene(pngBytes);
const pngScene = JSON.parse(pngPayload);
console.log(`[png] ok — type=${pngScene.type} version=${pngScene.version} elements=${pngScene.elements.length}`);

// Parity: PNG and SVG embed the same scene.
if (JSON.stringify(svgScene) !== JSON.stringify(pngScene)) {
  console.error("[parity] PNG and SVG payloads diverge");
  process.exit(4);
}
console.log("[parity] PNG and SVG payloads match");

// Canonical JSON files: sanity-parse + type check.
for (const name of ["1-shapes.excalidraw", "2-flowchart.excalidraw", "3-icons.excalidrawlib"]) {
  const j = JSON.parse(readFileSync(resolve(here, name), "utf8"));
  const expected = name.endsWith("lib") ? "excalidrawlib" : "excalidraw";
  if (j.type !== expected) {
    console.error(`[${name}] wrong type=${j.type} expected=${expected}`);
    process.exit(5);
  }
  console.log(`[${name}] ok — type=${j.type} version=${j.version}`);
}

console.log("ALL OK");
