/**
 * Formats stock counts with unit names (e.g. 6 Strips, 138 Vials, 12 Bottles, 1 Box).
 */
export function formatStockUnit(
  count: number,
  m: { unit?: string | null; dosageForm?: string | null; stripSize?: number | null }
): string {
  if (count <= 0) return "Out of stock";

  let u = (m.unit || "").trim();
  if (!u) {
    const form = (m.dosageForm || "").toLowerCase();
    if (form.includes("injection") || form.includes("vial")) u = "Vial";
    else if (
      form.includes("syrup") ||
      form.includes("liquid") ||
      form.includes("drop") ||
      form.includes("suspension") ||
      form.includes("solution") ||
      form.includes("elixir")
    )
      u = "Bottle";
    else if (form.includes("tablet") || form.includes("capsule"))
      u = (m.stripSize ?? 1) > 1 ? "Strip" : "Pack";
    else u = "Pack";
  }

  let plural = u;
  if (count !== 1) {
    const lower = u.toLowerCase();
    if (lower === "box") plural = "Boxes";
    else if (
      lower.endsWith("s") ||
      lower.endsWith("x") ||
      lower.endsWith("z") ||
      lower.endsWith("ch") ||
      lower.endsWith("sh")
    )
      plural = `${u}es`;
    else if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower))
      plural = `${u.slice(0, -1)}ies`;
    else plural = `${u}s`;
  }

  return `${count} ${plural} in stock`;
}

/**
 * Returns just the unit label (pluralized if count != 1).
 */
export function getUnitLabel(
  count: number,
  m: { unit?: string | null; dosageForm?: string | null; stripSize?: number | null }
): string {
  let u = (m.unit || "").trim();
  if (!u) {
    const form = (m.dosageForm || "").toLowerCase();
    if (form.includes("injection") || form.includes("vial")) u = "Vial";
    else if (
      form.includes("syrup") ||
      form.includes("liquid") ||
      form.includes("drop") ||
      form.includes("suspension") ||
      form.includes("solution")
    )
      u = "Bottle";
    else if (form.includes("tablet") || form.includes("capsule"))
      u = (m.stripSize ?? 1) > 1 ? "Strip" : "Pack";
    else u = "Pack";
  }

  if (count !== 1) {
    const lower = u.toLowerCase();
    if (lower === "box") return "Boxes";
    if (
      lower.endsWith("s") ||
      lower.endsWith("x") ||
      lower.endsWith("z") ||
      lower.endsWith("ch") ||
      lower.endsWith("sh")
    )
      return `${u}es`;
    if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower))
      return `${u.slice(0, -1)}ies`;
    return `${u}s`;
  }
  return u;
}
