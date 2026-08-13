"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";
import { Printer, FileText } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
 * Official prescription layout.
 *
 * Renders the real letterhead from frontend/public/Prescription svg.svg as the
 * base layer and overlays dynamic content on top. The letterhead already
 * carries the pharmacy brand ("RADHA MADHAV MEDICAL HALL"), the pre-printed
 * patient form, the Rx symbol and the footer contact block — those stay.
 *
 * What the SVG bakes in that must be dynamic:
 *   - the doctor identity (top-left name + credentials) — one doctor's text is
 *     baked in the source file, so those paths are stripped and replaced with
 *     the live doctor from the prescription record;
 *   - the service list on the teal band — replaced with the doctor's
 *     specialties when the data has them.
 *
 * The sheet is 595 x 842 (the SVG's own coordinate system), so every overlay
 * coordinate maps 1:1 to the letterhead. It scales as one unit for printing.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PrescriptionTemplateItem {
  medicineName?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantityPrescribed?: number | null;
  quantityDispensed?: number | null;
}

export interface PrescriptionTemplateData {
  id: string;
  prescriptionNumber?: string | null;
  issuedDate?: string | null;
  expiryDate?: string | null;
  doctorName?: string | null;
  doctorQualification?: string | null;
  doctorDesignation?: string | null;
  regNo?: string | null;
  hospitalName?: string | null;
  /** Doctor's specialty/service lines, rendered on the teal band (always provided by toPrescriptionTemplateData). */
  specialties: string[];
  patientName?: string | null;
  patientAge?: string | null;
  patientGender?: string | null;
  notes?: string | null;
  items: PrescriptionTemplateItem[];
}

const BRAND = "Radha Madhav Medical Hall";
const TEAL = "#00807A";
const INK = "#344B4A";

const LETTERHEAD_URL = "/Prescription%20svg.svg";

/** Normalizes any prescription payload shape (detail, list, public) into the template's data model. */
export function toPrescriptionTemplateData(raw: unknown): PrescriptionTemplateData {
  const rx = (raw as any)?.data?.data ?? (raw as any)?.data ?? raw ?? {};
  const patient = rx?.patient;
  const specialties = Array.isArray(rx?.specialties)
    ? rx.specialties.map(String)
    : typeof rx?.specialty === "string" && rx.specialty.trim()
      ? rx.specialty.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [];
  return {
    id: rx?.id ?? "",
    prescriptionNumber: rx?.prescriptionNumber ?? null,
    issuedDate: rx?.issuedDate ?? rx?.createdAt ?? null,
    expiryDate: rx?.expiryDate ?? null,
    doctorName: rx?.doctorName ?? null,
    doctorQualification: rx?.doctorQualification ?? rx?.specialty ?? null,
    doctorDesignation: rx?.doctorDesignation ?? null,
    regNo: rx?.regNo ?? null,
    hospitalName: rx?.hospitalName ?? null,
    specialties,
    patientName: rx?.patientName ?? patient?.name ?? null,
    patientAge: rx?.patientAge ?? patient?.age ?? null,
    patientGender: rx?.patientGender ?? patient?.gender ?? null,
    notes: rx?.notes ?? null,
    items: Array.isArray(rx?.items)
      ? rx.items.map((it: any) => ({
          medicineName: it?.medicine?.name ?? it?.medicineName ?? it?.productName ?? null,
          dosage: it?.dosage ?? null,
          frequency: it?.frequency ?? null,
          duration: it?.duration ?? null,
          quantityPrescribed: it?.quantityPrescribed ?? null,
          quantityDispensed: it?.quantityDispensed ?? null,
        }))
      : [],
  };
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd MMM yyyy");
}

function displayDoctorName(name?: string | null) {
  if (!name) return "Dr. Attending Physician";
  return /^dr\.?\s/i.test(name.trim()) ? name.trim() : `Dr. ${name.trim()}`;
}

/* ─────────────────────── Letterhead sanitization ───────────────────────
 * Removes the paths that belong to the source doctor (name, credentials and
 * the service list on the band, plus its row dashes) so the live doctor's
 * details can be overlaid without double text. Everything else — brand, form,
 * Rx symbol, footer, watermarks — stays untouched.
 */
function sanitizeLetterhead(svg: string): string {
  return svg.replace(/<path\b[^>]*\/>/g, (tag) => {
    if (tag.includes('opacity="0.5"')) return ""; // band row dashes
    if (tag.includes('fill="white"') && tag.includes("M41.544 164.727")) return ""; // band service list
    if (tag.includes('fill="#00807A"') && tag.includes("M42.8839 50.8193")) return ""; // doctor name
    if (tag.includes('fill="#344B4A"') && tag.includes("M38.876 56.8456")) return ""; // doctor credentials
    return tag;
  });
}

/* ─────────────────────────────── The A4 sheet ─────────────────────────────── */

export function PrescriptionTemplate({
  rx,
  letterheadSvg,
}: {
  rx: PrescriptionTemplateData;
  /** Pre-resolved letterhead SVG content (used by SSR/smoke tests); otherwise fetched from /public. */
  letterheadSvg?: string;
}) {
  const [svg, setSvg] = useState<string | null>(letterheadSvg ?? null);

  useEffect(() => {
    if (letterheadSvg) {
      setSvg(letterheadSvg);
      return;
    }
    let cancelled = false;
    fetch(LETTERHEAD_URL)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((text) => {
        if (!cancelled) setSvg(text);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [letterheadSvg]);

  const docName = displayDoctorName(rx.doctorName);
  const docLines = [
    rx.doctorQualification,
    rx.doctorDesignation,
    rx.hospitalName,
    rx.regNo ? `Reg No: ${rx.regNo}` : null,
  ].filter(Boolean);
  const patientLine = [rx.patientAge, rx.patientGender].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        width: 595,
        height: 842,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        color: INK,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* Layer 1 — the real letterhead */}
      {svg ? (
        <div
          dangerouslySetInnerHTML={{ __html: sanitizeLetterhead(svg) }}
          style={{ position: "absolute", inset: 0, width: 595, height: 842 }}
        />
      ) : (
        <FallbackLetterhead />
      )}

      {/* Layer 2 — dynamic content, positioned in the letterhead's own coords */}

      {/* Doctor identity (top-left) */}
      <div style={{ position: "absolute", left: 39, top: 34, width: 470 }}>
        <div style={{ color: TEAL, fontWeight: 800, fontSize: 13.5, lineHeight: 1.2 }}>
          {docName}
        </div>
        {docLines.slice(0, 4).map((line, i) => (
          <div
            key={i}
            style={{
              color: INK,
              fontSize: 9.5,
              lineHeight: 1.15,
              marginTop: i === 0 ? 5 : 1,
            }}
          >
            {line}
          </div>
        ))}
      </div>

      {/* Doctor's service list on the teal band */}
      {rx.specialties.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 38,
            top: 164,
            width: 152,
            color: "#fff",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            lineHeight: 1.45,
          }}
        >
          {rx.specialties.slice(0, 9).map((s, i) => (
            <div key={i} style={{ marginBottom: 3 }}>
              {s}
            </div>
          ))}
        </div>
      )}

      {/* Patient name filled into the pre-printed "Name:" form row */}
      {rx.patientName && (
        <div
          style={{
            position: "absolute",
            left: 300,
            top: 151,
            fontSize: 12,
            fontWeight: 700,
            color: INK,
          }}
        >
          {rx.patientName}
          {patientLine && (
            <span style={{ fontWeight: 600, color: "#5A6E6B" }}> · {patientLine}</span>
          )}
        </div>
      )}

      {/* Rx meta + medicines + notes (below the pre-printed form) */}
      <div style={{ position: "absolute", left: 210, top: 318, width: 358 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 8.5,
            color: "#5A6E6B",
            letterSpacing: 0.4,
            borderBottom: "0.5px solid #DCECEA",
            paddingBottom: 4,
          }}
        >
          <span>Rx: #{rx.prescriptionNumber || rx.id.slice(0, 8).toUpperCase()}</span>
          <span>Issued: {fmtDate(rx.issuedDate)}</span>
          <span>Valid till: {fmtDate(rx.expiryDate)}</span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginTop: 7 }}>
          <thead>
            <tr style={{ color: TEAL, textAlign: "left" }}>
              {["#", "Medicine", "Dosage", "Frequency", "Duration", "Qty"].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: "3px 4px",
                    fontSize: 8,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    fontWeight: 700,
                    borderBottom: `1.5px solid ${TEAL}`,
                    textAlign: i === 5 ? "right" : "left",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rx.items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: "10px 4px", color: "#8A9A97", fontStyle: "italic" }}
                >
                  No typed medicine lines on this prescription.
                </td>
              </tr>
            ) : (
              rx.items.map((it, i) => (
                <tr key={i} style={{ borderBottom: "0.5px solid #E4ECEB" }}>
                  <td style={{ padding: "3.5px 4px", color: "#8A9A97", width: 16 }}>{i + 1}</td>
                  <td style={{ padding: "3.5px 4px", fontWeight: 700, width: "34%" }}>
                    {it.medicineName || "Medicine"}
                  </td>
                  <td style={{ padding: "3.5px 4px" }}>{it.dosage || "—"}</td>
                  <td style={{ padding: "3.5px 4px" }}>{it.frequency || "—"}</td>
                  <td style={{ padding: "3.5px 4px" }}>{it.duration || "—"}</td>
                  <td style={{ padding: "3.5px 4px", textAlign: "right", fontWeight: 700 }}>
                    {it.quantityPrescribed ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {rx.notes && (
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 8,
                color: "#8A9A97",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Notes
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: INK,
                marginTop: 2,
                whiteSpace: "pre-wrap",
                lineHeight: 1.45,
              }}
            >
              {rx.notes}
            </div>
          </div>
        )}
      </div>

      {/* Signature (above the letterhead's own footer) */}
      <div style={{ position: "absolute", right: 36, bottom: 60, textAlign: "center", width: 200 }}>
        <div
          style={{
            borderTop: "1px solid #B9C7C5",
            paddingTop: 4,
            fontWeight: 800,
            fontSize: 11,
            color: INK,
          }}
        >
          {docName}
        </div>
        <div
          style={{
            fontSize: 8,
            color: "#8A9A97",
            letterSpacing: 1.5,
            textTransform: "uppercase",
            marginTop: 2,
            fontWeight: 700,
          }}
        >
          Signature
        </div>
      </div>
    </div>
  );
}

/* Minimal CSS fallback shown while the letterhead loads or if it cannot be fetched. */
function FallbackLetterhead() {
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 118,
          left: -46,
          width: 258,
          height: 552,
          borderRadius: 14,
          background: TEAL,
        }}
      />
      <div style={{ position: "absolute", right: 36, top: 52, textAlign: "right" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: TEAL, letterSpacing: 2 }}>
          {BRAND.toUpperCase()}
        </div>
        <div style={{ fontSize: 8, color: "#8A9A97", letterSpacing: 1.5, marginTop: 3 }}>
          DIGITAL HEALTHCARE RECORD
        </div>
      </div>
    </>
  );
}

/* ─────────────────────── Preview + print modal ─────────────────────── */

const PREVIEW_SCALE = 0.55;

export function PrescriptionPrintModal({
  rx,
  open,
  onClose,
}: {
  rx: PrescriptionTemplateData;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open &&
        createPortal(
          // Print-only copy, rendered outside the dialog so it survives print.
          // The global print rule hides [role="dialog"] with display:none, which
          // no visibility trick can override, so the sheet is portaled to <body>
          // and shown only within @media print below.
          <div id="printable-prescription-sheet" className="hidden" aria-hidden="true">
            <div style={{ transform: "scale(0.93)", transformOrigin: "top center" }}>
              <PrescriptionTemplate rx={rx} />
            </div>
          </div>,
          document.body,
        )}

      <Modal
        title="Print Prescription"
        subtitle="Official prescription layout — prints on A4"
        icon={<FileText size={16} />}
        open={open}
        onClose={onClose}
        size="xl"
      >
        <div className="space-y-5">
          {/* On-screen preview */}
          <div className="flex justify-center overflow-auto rounded-xl bg-slate-100 border border-slate-200 p-4 max-h-[58vh]">
            <div
              style={{
                width: Math.round(595 * PREVIEW_SCALE),
                height: Math.round(842 * PREVIEW_SCALE),
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  transform: `scale(${PREVIEW_SCALE})`,
                  transformOrigin: "top left",
                }}
              >
                <PrescriptionTemplate rx={rx} />
              </div>
            </div>
          </div>

          <style jsx global>{`
            @media print {
              body * {
                visibility: hidden !important;
              }
              #printable-prescription-sheet,
              #printable-prescription-sheet * {
                visibility: visible !important;
              }
              #printable-prescription-sheet {
                position: absolute !important;
                left: 50% !important;
                top: 0 !important;
                transform: translateX(-50%) !important;
                transform-origin: top center !important;
                display: block !important;
              }
            }
          `}</style>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 shadow-sm transition-all"
            >
              <Printer size={16} />
              Print Prescription
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
