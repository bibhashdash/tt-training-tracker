// Generates the app icons as PNGs with Next's ImageResponse renderer.
// Run once after changing the design: `node scripts/generate-icons.mjs`
import { mkdirSync, writeFileSync } from "node:fs";
import { createElement as h } from "react";
import { createRequire } from "node:module";
const { ImageResponse } = createRequire(import.meta.url)("next/og");

const BG = "#18181b"; // zinc-900
const ACCENT = "#10b981"; // emerald-500

/** A solid "T" drawn from two bars (the built-in font has no bold weight). */
function tee(w, stroke) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", width: w } },
    h("div", { style: { display: "flex", width: w, height: stroke, background: "white", borderRadius: stroke * 0.15 } }),
    h("div", { style: { display: "flex", width: stroke, height: w * 1.05, background: "white" } }),
  );
}

/** "TT" with an accent bar. `scale` shrinks the mark for maskable icons' safe zone. */
function mark(size, scale = 1) {
  const w = size * 0.26 * scale; // width of each T
  const stroke = Math.max(3, size * 0.075 * scale);
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: BG,
      },
    },
    h("div", { style: { display: "flex", gap: size * 0.03 * scale } }, tee(w, stroke), tee(w, stroke)),
    h("div", {
      style: {
        display: "flex",
        marginTop: size * 0.07 * scale,
        width: w * 2 + size * 0.03 * scale,
        height: stroke * 0.8,
        borderRadius: 999,
        background: ACCENT,
      },
    }),
  );
}

async function png(size, scale, out) {
  const res = new ImageResponse(mark(size, scale), { width: size, height: size });
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log("wrote", out);
}

mkdirSync("public/icons", { recursive: true });
await png(192, 1, "public/icons/icon-192.png");
await png(512, 1, "public/icons/icon-512.png");
await png(512, 0.7, "public/icons/icon-maskable-512.png"); // content inside the 80% safe zone
await png(180, 1, "app/apple-icon.png"); // iOS home screen; iOS rounds the corners
await png(64, 1, "app/icon.png"); // browser tab
