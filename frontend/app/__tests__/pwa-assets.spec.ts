import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Install-surface smoke tests.
 *
 * None of this is exercised by rendering the app: the icons are only read by
 * the browser at install time, on a device nobody is looking at during a
 * deploy. A missing file or a size that does not match what the manifest
 * claims shows up as a blank home-screen tile weeks later, so it is checked
 * here instead.
 */

const ROOT = resolve(__dirname, "..", "..");
const publicFile = (name: string) => resolve(ROOT, "public", name);

/** Width and height out of a PNG's IHDR chunk, which is always the first one. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const manifest = JSON.parse(readFileSync(publicFile("manifest.json"), "utf8"));

describe("web app manifest", () => {
  it("keeps the identity fields an installed app is listed under", () => {
    expect(manifest.name).toBe("Radha Madhav Medical Hall");
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("ships the raster sizes Android install and splash screens ask for", () => {
    const png = manifest.icons.filter((i: any) => i.type === "image/png");
    const sizes = png.map((i: any) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("declares exactly one maskable icon, and it is a raster", () => {
    const maskable = manifest.icons.filter((i: any) =>
      String(i.purpose ?? "").split(/\s+/).includes("maskable"),
    );
    expect(maskable).toHaveLength(1);
    expect(maskable[0].type).toBe("image/png");
  });

  it("points every icon at a file that exists and is the size it claims", () => {
    for (const icon of manifest.icons) {
      const bytes = readFileSync(publicFile(icon.src.replace(/^\//, "")));
      expect(bytes.byteLength).toBeGreaterThan(0);

      if (icon.type !== "image/png") continue;
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(bytes)).toEqual({ width, height });
    }
  });
});

describe("iOS home screen icon", () => {
  it("is a 180px PNG, because Safari ignores an SVG apple-touch-icon", () => {
    // Regression: this used to point at /logo.svg, which left an iPhone install
    // showing a screenshot of the page instead of the logo.
    const bytes = readFileSync(publicFile("apple-touch-icon.png"));
    expect(pngSize(bytes)).toEqual({ width: 180, height: 180 });
  });

  it("is referenced from the root layout", () => {
    const layout = readFileSync(resolve(ROOT, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("/apple-touch-icon.png");
    expect(layout).not.toMatch(/apple:\s*"\/logo\.svg"/);
  });
});

describe("viewport", () => {
  it("leaves pinch zoom available", () => {
    // WCAG 1.4.4, and counter staff magnify batch numbers and Rx photos.
    const layout = readFileSync(resolve(ROOT, "app", "layout.tsx"), "utf8");
    expect(layout).not.toMatch(/maximumScale:\s*1\b/);
    expect(layout).toMatch(/userScalable:\s*true/);
  });
});
