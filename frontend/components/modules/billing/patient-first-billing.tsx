"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  UserPlus,
  Phone,
  ChevronRight,
  ShoppingCart,
  Users,
  ArrowRight,
  AlertCircle,
  Sparkles,
  Pill,
  Clock,
  Ticket,
  FileText,
  Stethoscope,
  CheckCircle2,
  X,
  Plus,
  Minus,
  IndianRupee,
  RefreshCw,
  LayoutList,
  PackagePlus,
} from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { MedicineForm } from "@/components/modules/inventory/medicine-form";
import { MedicineStockModal } from "@/components/modules/inventory/medicine-stock-modal";
import { useCreateClinicToken } from "@/queries/clinic.queries";
import { useNavigation } from "@/lib/navigation-context";
import { useDebounce } from "@/hooks/use-debounce";
import { useActiveBranchId } from "@/hooks/use-branch";
import { localDateString } from "@/lib/date";
import { QuickPatientForm, QuickPatient } from "@/components/modules/patients/quick-patient-form";
import { CounterDeskModals, DeskModalView } from "@/components/modules/billing/counter-desk-modals";
import { DoctorMedicinesPanel } from "@/components/modules/billing/doctor-medicines-panel";
import { DoctorsOverview } from "@/components/modules/billing/doctors-overview";
import { DoctorMedicineManager } from "@/components/modules/clinic/doctor-medicine-manager";
import { OtcCounterSale } from "@/components/modules/billing/otc-counter-sale";
import { InvoiceDetailModal } from "@/components/modules/billing/invoice-detail-modal";
import { isValidPhoneNumber } from "@/lib/phone-validation";
import { useToast } from "@/components/ui/toast";
import { useCartStore } from "@/stores/cart.store";
import { useAuthStore } from "@/stores/auth.store";
import { usePermissions } from "@/hooks/use-permissions";
import { formatStockUnit } from "@/lib/stock-unit-formatter";

type DeskPath = "prescription" | "doctor" | "otc" | null;

/**
 * New billing flow — the patient-first counter desk journey.
 *
 * Mirrors the reference one-screen flow: find the patient, pick what they
 * need today (fill a prescription / book a doctor / OTC medicine), build the
 * bill on this screen, then hand the filled cart to the POS terminal for
 * stock allocation, payment and printing.
 *
 * The cart is written to the shared cart store, which the POS rehydrates on
 * mount — so checkout carries the patient, Rx link, consultation fee and all
 * line items without duplicating any of the POS checkout logic.
 *
 * The legacy medicine-first POS is never removed — "Open Classic POS" stays on
 * this screen so a branch can fall back to it at any moment.
 */
export function PatientFirstBilling({
  onContinueToPayment,
}: {
  /** Called when the built bill is handed over — the host page shows the POS for payment inline (new flow never navigates to the classic POS route). */
  onContinueToPayment?: () => void;
}) {
  const { navigate } = useNavigation();
  const { success: toastSuccess, warning: toastWarning, info: toastInfo, error: toastError } = useToast();
  const { user } = useAuthStore();
  // OTC hand-outs are an admin/shop-manager action (see the API's @Roles); a
  // doctor must not see a button that would 403 on click.
  const { can: canPerm } = usePermissions();
  // The OTC modal now bills by default and only falls back to a free hand-out,
  // so either permission opens it — the modal disables the path you lack.
  const canOtc = canPerm("billing.create") || canPerm("inventory.adjust");
  // A medicine the counter cannot sell is a counter problem, so the two fixes
  // live on this screen too: receive a batch for something that ran out, and
  // register something the catalogue has never heard of.
  const canAddStock = canPerm("inventory.write");
  const canAddMedicine = canPerm("products.write");
  const queryClient = useQueryClient();
  const [nowTick, setNowTick] = useState(Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [path, setPath] = useState<DeskPath>(null);
  const [deskModal, setDeskModal] = useState<DeskModalView>(null);
  const { branchId: activeBranchId } = useActiveBranchId();
  const today = localDateString();

  // Shared cart — the POS terminal reads the same store, so anything built
  // here shows up there when we hand off for payment.
  const cart = useCartStore();

  /**
   * Packs this bill has already claimed, per medicine. The search list shows
   * what is still on the shelf, so a counter hand does not promise the same
   * bottle twice while building one bill.
   *
   * `totalStock` counts packs, and a line added as loose pills stores its
   * quantity in pills, so those convert back through stripSize.
   */
  const reservedPacksByMedicine = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of cart.items) {
      const packs =
        i.saleUnit === "loose" ? i.quantity / (i.stripSize || 1) : i.quantity;
      map.set(i.medicineId, (map.get(i.medicineId) ?? 0) + packs);
    }
    return map;
  }, [cart.items]);

  /** Whole packs of this medicine already on the bill. */
  const inBillPacks = (m: { id: string }) =>
    Math.round(reservedPacksByMedicine.get(m.id) ?? 0);

  /**
   * Shelf stock less what this bill holds. Floored, because a part-consumed
   * pack is no longer a whole one the counter can hand over.
   */
  const remainingStock = (m: { id: string; totalStock?: unknown }) => {
    const onShelf = Number(m.totalStock || 0);
    const taken = reservedPacksByMedicine.get(m.id) ?? 0;
    return Math.max(0, Math.floor(onShelf - taken));
  };

  const branchParams = activeBranchId ? { branchId: activeBranchId } : {};

  // Keep the ongoing-consultation "last N minutes" timer live.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const minutesSince = (iso?: string | null) => {
    if (!iso) return 0;
    return Math.max(0, Math.floor((nowTick - new Date(iso).getTime()) / 60_000));
  };

  const formatTime = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // ── Total sale today (end-of-day summary for today) ────────────────────────
  const { data: todaysSaleRaw } = useQuery({
    queryKey: ["counter-today-sale", today, activeBranchId],
    queryFn: () =>
      apiClient.get("/billing/reports/end-of-day", { params: { date: today, ...branchParams } }) as any,
    retry: 1,
  });
  const todaysSale: number = (() => {
    const raw = todaysSaleRaw as any;
    const s = raw?.data ?? raw;
    if (typeof s?.totalSales === "number") return s.totalSales;
    return 0;
  })();

  // ── Counter desk stat cards ────────────────────────────────────────────────
  const { data: lowStockRaw } = useQuery({
    queryKey: ["counter-low-stock", activeBranchId],
    queryFn: () => apiClient.get("/inventory/medicines/low-stock", { params: branchParams }) as any,
    retry: 1,
  });
  const lowStockCount: number = (() => {
    const raw = lowStockRaw as any;
    if (Array.isArray(raw)) return raw.length;
    if (Array.isArray(raw?.data)) return raw.data.length;
    if (Array.isArray(raw?.data?.data)) return raw.data.data.length;
    return 0;
  })();

  // Prescriptions created today (list is createdAt-desc; count locally by date).
  const { data: rxTodayRaw } = useQuery({
    queryKey: ["counter-rx-today", activeBranchId],
    queryFn: () => apiClient.get("/prescriptions", { params: { ...branchParams, limit: 100 } }) as any,
    retry: 1,
  });
  const rxTodayCount: number = (() => {
    const raw = rxTodayRaw as any;
    const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.data?.data) ? raw.data.data : [];
    if (rows.length === 0) return 0;
    return rows.filter((r: any) => {
      const d = r?.createdAt ?? r?.issuedDate;
      if (!d) return false;
      return String(d).slice(0, 10) === today;
    }).length;
  })();

  // Free hand-outs today (from the stock ledger). Paid OTC sales are billed
  // through the invoice route now, so they land in the sales figures; only
  // give-aways with no money attached are counted here.
  const { data: otcTodayRaw } = useQuery({
    queryKey: ["counter-otc-today", today, activeBranchId],
    queryFn: () =>
      apiClient.get("/inventory/medicines/otc-supplies", {
        params: { date: today, ...branchParams },
      }) as any,
    retry: 1,
  });
  const otcToday: { supplies: number; units: number } = (() => {
    const raw = otcTodayRaw as any;
    const d = raw?.data ?? raw;
    return {
      supplies: Number(d?.supplies ?? 0),
      units: Number(d?.units ?? 0),
    };
  })();

  // Recently served today — the last few billed customers, so a returning
  // patient can be picked up again without a fresh search.
  const { data: servedTodayRaw } = useQuery({
    queryKey: ["counter-served-today", today, activeBranchId],
    queryFn: () =>
      apiClient.get("/billing/invoices", {
        params: { from: today, to: today, limit: 5, ...branchParams },
      }) as any,
    retry: 1,
  });
  const servedToday: any[] = (() => {
    const raw = servedTodayRaw as any;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    return [];
  })();

  // Today's clinic queue — drives "patients visited by doctors", the ongoing
  // consultation card and the next appointment card.
  const { data: queueRaw } = useQuery({
    queryKey: ["counter-clinic-queue", today, activeBranchId],
    queryFn: () => apiClient.get("/clinic/tokens", { params: { date: today, ...branchParams, limit: 100 } }) as any,
    retry: 1,
  });
  const queueRows: any[] = (() => {
    const raw = queueRaw as any;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    return [];
  })();
  const visitedByDoctors = new Set(
    queueRows
      .filter((t: any) => t.status === "called" || t.status === "completed")
      .map((t: any) => t.patientId ?? t.patient?.id)
      .filter(Boolean),
  ).size;
  const ongoingToken = queueRows.find((t: any) => t.status === "called") ?? null;
  const nextToken = queueRows.find((t: any) => t.status === "pending") ?? null;
  const docDisplay = (t: any) => {
    const d = t?.doctor;
    if (!d) return t?.doctorName ?? "—";
    return [d.firstName, d.lastName].filter(Boolean).join(" ") || d.email || "Doctor";
  };

  // ── Unified search: patients AND medicines ────────────────────────────────
  const debounced = useDebounce(query, 300);
  const searchActive = debounced.trim().length >= 3;

  const { data: searchRaw, isFetching } = useQuery({
    queryKey: ["patient-search-counter", debounced],
    queryFn: () =>
      apiClient.get("/patients", {
        params: { search: debounced, limit: 6 },
      }) as any,
    enabled: searchActive,
  });

  // Medicines share the same search box — the counter desk also supplies OTC
  // medicines without a bill, so staff can look up any medicine right here.
  const { data: medSearchRaw, isFetching: medSearching } = useQuery({
    queryKey: ["medicine-search-counter", debounced, activeBranchId],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        params: { search: debounced, limit: 6 },
      }) as any,
    enabled: searchActive,
  });

  const patients: any[] = (() => {
    const raw = searchRaw as any;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw)) return raw;
    return [];
  })();

  const medResults: any[] = (() => {
    const raw = medSearchRaw as any;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw)) return raw;
    return [];
  })();

  // Whole medicine row, not just id+name: the OTC modal prices the sale from
  // its MRP, tax rate and strip size.
  const [otcSupplyTarget, setOtcSupplyTarget] = useState<any | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  // Restock target for the counter desk's inline "Add stock" action.
  const [stockTarget, setStockTarget] = useState<any | null>(null);
  // Set to the typed search text when registering a medicine that isn't in the
  // catalogue yet, so the form opens with the name already filled.
  const [newMedicineName, setNewMedicineName] = useState<string | null>(null);

  // The counter search keeps its own query keys, so the inventory modals'
  // invalidations don't reach it — refresh it by hand after either fix.
  const refreshMedicineSearch = () => {
    queryClient.invalidateQueries({ queryKey: ["medicine-search-counter"] });
    queryClient.invalidateQueries({ queryKey: ["counter-medicine-search"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.medicines.all() });
  };

  const selectedPatientRaw = cart.patientId
    ? patients.find((p) => p.id === cart.patientId)
    : null;

  // The cart store only keeps the patient id; fetch the full record so the
  // desk can render the patient card without relying on the search list.
  const { data: selectedPatientDetail } = useQuery({
    queryKey: ["counter-patient-detail", cart.patientId],
    queryFn: () => apiClient.get(`/patients/${cart.patientId}`) as any,
    enabled: !!cart.patientId,
  });
  const selectedPatientRaw2: any =
    (selectedPatientDetail as any)?.data ?? selectedPatientDetail ?? null;
  const selectedPatient =
    selectedPatientRaw ??
    (selectedPatientRaw2?.data ?? selectedPatientRaw2) ??
    null;

  const openPosFor = (patientId: string) => {
    // Write to the shared cart first; POS rehydrates on mount.
    cart.setPatient(patientId);
    navigate(`/billing/pos`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      toastWarning("Enter more characters", "Type at least 3 characters of the mobile number or name.");
      return;
    }
    if (isValidPhoneNumber(trimmed)) {
      const exact = patients.find(
        (p) => (p.phone ?? "").replace(/[^0-9]/g, "").endsWith(trimmed.replace(/[^0-9]/g, "")),
      );
      if (exact) {
        selectPatient(exact.id, exact.name);
        return;
      }
    }
    setSubmitted(trimmed);
    setShowResults(true);
  };

  const selectPatient = (id: string, name: string) => {
    cart.setPatient(id);
    setQuery(name);
    setShowResults(false);
    setPath(null);
    setRegistering(false);
    toastInfo("Patient selected", "Choose what they need today, or jump straight to OTC.");
  };

  const clearPatient = () => {
    cart.clear();
    setQuery("");
    setPath(null);
  };

  const startPath = (p: DeskPath) => {
    if (!cart.patientId) {
      toastWarning("Select a patient first", "Search or create the patient before starting a path.");
      return;
    }
    // Leaving and re-entering the doctor path should land on the doctor grid,
    // not on whichever doctor's medicine list was open last time.
    setMedsForDoctor(null);
    setPath(p);
  };

  // ── Rx path: verified prescriptions for this patient ──────────────────────
  const { data: rxListRaw, isFetching: rxFetching } = useQuery({
    queryKey: ["counter-rx-list", cart.patientId],
    queryFn: () =>
      apiClient.get("/prescriptions", {
        params: { patientId: cart.patientId || undefined, status: "verified", limit: 10 },
      }) as any,
    enabled: path === "prescription" && !!cart.patientId,
  });
  const rxList: any[] = (() => {
    const raw = rxListRaw as any;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw)) return raw;
    return [];
  })();

  // ── Doctor path: also issues the patient a clinic token so the doctor's
  // queue stays intact — booking a doctor on the desk is a queue entry too.
  const createToken = useCreateClinicToken();
  const [tokenLoadingId, setTokenLoadingId] = useState<string | null>(null);

  const [rxLoadingId, setRxLoadingId] = useState<string | null>(null);

  const loadRxIntoCart = async (rx: any) => {
    setRxLoadingId(rx.id);
    try {
      // Full detail with items, if the list row lacks them.
      let detail = rx;
      if (!Array.isArray(rx?.items)) {
        const res: any = await apiClient.get(`/prescriptions/${rx.id}`);
        detail = res?.data?.data ?? res?.data ?? res;
      }
      const rxItems: any[] = Array.isArray(detail?.items) ? detail.items : [];
      if (rxItems.length === 0) {
        toastInfo("Prescription loaded", "This prescription has no medicine items to add to the bill.");
        cart.setPrescriptionId(rx.id);
        setPath(null);
        return;
      }
      const warnings: string[] = [];
      for (const item of rxItems) {
        const med = item?.medicine ?? null;
        const medId = item.medicineId ?? med?.id;
        const label = med?.name ?? item.medicineName ?? "Medicine";
        if (!medId) {
          warnings.push(label);
          continue;
        }
        try {
          const batchesRes: any = await apiClient.get(`/inventory/medicines/${medId}/batches`, {
            params: { branchId: activeBranchId },
          });
          const batchList: any[] = Array.isArray(batchesRes)
            ? batchesRes
            : Array.isArray(batchesRes?.data?.data)
              ? batchesRes.data.data
              : Array.isArray(batchesRes?.data)
                ? batchesRes.data
                : [];
          const first = batchList[0];
          const availableQty = first?.quantity ?? 0;
          if (!first || availableQty <= 0) {
            warnings.push(label);
            continue;
          }
          cart.addItem({
            medicineId: medId,
            batchId: first.id,
            name: label,
            sku: med?.sku ?? item.medicineName ?? "",
            batchNo: first.batchNo,
            unitPrice: parseFloat(med?.priceMrp ?? "0") || 0,
            stripSize: med?.stripSize ? Number(med.stripSize) : 1,
            taxPct: parseFloat(med?.taxPercent ?? "0") || 0,
            discountPct: 0,
            quantity: item.quantityPrescribed || 1,
            scheduleClass: med?.scheduleClass,
            requiresPrescription: med?.requiresPrescription,
            unit: med?.unit,
            batchStock: availableQty,
            totalStock: availableQty,
          });
        } catch {
          warnings.push(label);
        }
      }
      cart.setPrescriptionId(rx.id);
      setPath(null);
      if (warnings.length > 0) {
        toastWarning(
          "Some items skipped",
          `Out of stock or unlinked on this Rx: ${warnings.join(", ")}. Continue in POS to adjust.`,
          8000,
        );
      } else {
        toastSuccess("Prescription loaded", "Medicines added to the bill. Review below and continue to payment.");
      }
    } catch {
      toastError("Could not load prescription", "Failed to load the prescription items. Try again.");
    } finally {
      setRxLoadingId(null);
    }
  };

  // ── Doctor path: in-store doctors ──────────────────────────────────────────
  // Fetched unconditionally because the doctors-overview strip above the path
  // picker also renders these — previously the query was gated on path=doctor.
  const { data: doctorsRaw } = useQuery({
    queryKey: ["counter-doctors"],
    queryFn: () => apiClient.get("/clinic/doctors") as any,
  });
  const doctors: any[] = (() => {
    const raw = doctorsRaw as any;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    return [];
  })();

  // Which doctor's medicine list is open. Null = the doctor grid is showing.
  // Kept separate from `path` so closing the list returns to the grid rather
  // than dropping the counter staff back to the path chooser.
  const [medsForDoctor, setMedsForDoctor] = useState<any | null>(null);
  // Overview-triggered browsing: reachable without picking a patient first.
  // Rendered as a modal so it can appear from the top-of-page overview strip
  // without needing the path picker to be visible.
  const [browsingDoctor, setBrowsingDoctor] = useState<any | null>(null);
  // Which doctor's medicine list the operator is curating from the overview strip.
  const [managingMedicinesFor, setManagingMedicinesFor] = useState<any | null>(null);
  const canManageDoctorLists = user?.role !== "doctor";

  const bookDoctor = async (doc: any) => {
    const dp = doc?.doctorProfile;
    const fee = Number(dp?.consultationFee ?? 400);
    const name = [doc.firstName, doc.lastName].filter(Boolean).join(" ") || doc.email || "Doctor";

    // Issue the clinic token first — booking a doctor on the counter desk is
    // also a queue entry, so the doctor's queue stays intact and the token
    // appears on the clinic queue screen (pending, with the patient's name).
    if (!cart.patientId) {
      toastWarning("Select a patient first", "A patient is needed to issue the clinic token.");
      return;
    }
    setTokenLoadingId(doc.id);
    try {
      await createToken.mutateAsync({
        patientId: cart.patientId,
        doctorId: doc.id,
        date: today,
        branchId: activeBranchId,
      });
      cart.setConsultationFee({ doctorName: name, amount: fee });
      setPath(null);
      toastSuccess(
        "Consultation booked",
        `${name} — ₹${fee.toFixed(2)} fee added to the bill. Clinic token issued; the queue shows the patient as next in line.`,
      );
    } catch {
      toastError(
        "Could not book the doctor",
        "The clinic token could not be issued. Check the doctor is active and try again.",
      );
    } finally {
      setTokenLoadingId(null);
    }
  };

  // ── OTC path: medicine search + add ────────────────────────────────────────
  const [medicineSearch, setMedicineSearch] = useState("");
  const debouncedMeds = useDebounce(medicineSearch, 300);
  const { data: medsRaw, isFetching: medsFetching } = useQuery({
    queryKey: ["counter-medicine-search", debouncedMeds],
    queryFn: () => apiClient.get("/inventory/medicines", { params: { search: debouncedMeds, limit: 8, isActive: "all" } }) as any,
    enabled: path === "otc" && debouncedMeds.trim().length >= 2,
  });
  const meds: any[] = (() => {
    const raw = medsRaw as any;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw)) return raw;
    return [];
  })();
  const [medLoadingId, setMedLoadingId] = useState<string | null>(null);

  // Inactive medicine MRP edit state (shared with OTC search)
  const [inactiveMrpTarget, setInactiveMrpTarget] = useState<any | null>(null);
  const [inactiveMrpValue, setInactiveMrpValue] = useState("");
  const [inactiveMrpLoading, setInactiveMrpLoading] = useState(false);
  const [inactiveMrpError, setInactiveMrpError] = useState<string | null>(null);

  const confirmInactiveMrp = async () => {
    if (!inactiveMrpTarget) return;
    const mrp = parseFloat(inactiveMrpValue);
    if (!mrp || mrp <= 0) {
      setInactiveMrpError("Enter a valid MRP greater than zero.");
      return;
    }
    setInactiveMrpLoading(true);
    setInactiveMrpError(null);
    try {
      await apiClient.patch(`/inventory/medicines/${inactiveMrpTarget.id}`, {
        priceMrp: mrp.toFixed(2),
        isActive: true,
      });
      const patched = { ...inactiveMrpTarget, priceMrp: mrp.toFixed(2), isActive: true };
      setInactiveMrpTarget(null);
      setInactiveMrpValue("");
      toastSuccess("Medicine activated", `"${patched.name}" is now active at MRP ₹${mrp.toFixed(2)}.`);
      await addMedicineToCart(patched);
    } catch (err: any) {
      setInactiveMrpError(err?.response?.data?.message ?? "Failed to update MRP. Try again.");
    } finally {
      setInactiveMrpLoading(false);
    }
  };

  const addMedicineToCart = async (m: any) => {
    // Inactive medicines cannot be sold — prompt for MRP first.
    if (m.isActive === false) {
      setInactiveMrpTarget(m);
      setInactiveMrpValue(m.priceMrp && parseFloat(m.priceMrp) > 0 ? m.priceMrp : "");
      setInactiveMrpError(null);
      return;
    }
    setMedLoadingId(m.id);
    try {
      const batchRes: any = await apiClient.get(`/inventory/medicines/${m.id}/batches`, {
        params: { branchId: activeBranchId },
      });
      const batchArr: any[] = Array.isArray(batchRes)
        ? batchRes
        : Array.isArray(batchRes?.data?.data)
          ? batchRes.data.data
          : Array.isArray(batchRes?.data)
            ? batchRes.data
            : [];
      const first = batchArr[0];
      if (!first) {
        toastWarning("Out of stock", `No active batch found for "${m.name}". Add stock via Inventory first.`, 7000);
        return;
      }
      const availableQty = first.quantity ?? Number(m.totalStock ?? 99999);
      cart.addItem({
        medicineId: m.id,
        batchId: first.id,
        name: m.name,
        sku: m.sku,
        batchNo: first.batchNo,
        unitPrice: parseFloat(m.priceMrp),
        stripSize: m.stripSize ? parseInt(m.stripSize) : 1,
        taxPct: parseFloat(m.taxPercent ?? "0"),
        discountPct: 0,
        quantity: 1,
        scheduleClass: m.scheduleClass,
        requiresPrescription: m.requiresPrescription,
        unit: m.unit,
        batchStock: availableQty,
        totalStock: Number(m.totalStock ?? availableQty),
      });
      toastSuccess(`${m.name} added`, "Added to the bill. Quantity can be changed in the POS.");
    } catch {
      toastError("Failed to add", `Could not fetch stock for "${m.name}".`);
    } finally {
      setMedLoadingId(null);
    }
  };

  /**
   * Adds a row from a doctor's medicine list to the bill.
   *
   * Deliberately routed through the same `addMedicineToCart` the OTC search
   * uses — batch resolution, out-of-stock handling and the Schedule H flags on
   * the cart line all stay identical, so a doctor's list is a shortcut to the
   * medicine and never a second way of selling it.
   */
  const addDoctorMedicineToCart = (row: { medicineId: string } & Record<string, any>) =>
    addMedicineToCart({ ...row, id: row.medicineId });

  /**
   * Chip click from the overview strip. The strip renders before a patient is
   * chosen, so guard on cart.patientId here — otherwise a chip click would
   * silently add a line item that couldn't be finalised.
   */
  const addDoctorMedicineFromOverview = (
    row: { medicineId: string } & Record<string, any>,
  ) => {
    if (!cart.patientId) {
      toastWarning(
        "Select a patient first",
        "Pick or register the patient, then add the doctor's medicine.",
      );
      return;
    }
    return addDoctorMedicineToCart(row);
  };

  const totals = cart.totals();
  const cartItems = cart.items;
  const hasCart = cartItems.length > 0 || !!cart.consultationFee;

  const continueToPayment = () => {
    if (!hasCart) {
      toastWarning("Bill is empty", "Add at least one medicine or a consultation before continuing.");
      return;
    }
    if (onContinueToPayment) {
      onContinueToPayment();
      return;
    }
    // Fallback (standalone render): hand off to the POS route.
    navigate("/billing/pos");
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">          <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-700 shrink-0">
            <Users size={18} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
              Counter Desk Billing
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-extrabold uppercase tracking-wide border border-orange-200">
                <Sparkles size={10} /> New Flow
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Find the patient, pick what they need, then hand the bill to the POS for payment.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Total sale today — mirrors the reference header pill */}
          <div className="hidden sm:flex flex-col items-end rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total sale today</p>
            <p className="text-lg font-black text-slate-900 leading-tight">
              ₹{todaysSale.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          {user?.role === "super_admin" && (
            <button
              type="button"
              onClick={() => navigate("/billing/pos")}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 hover:text-slate-900 transition-all"
              title="Legacy medicine-first POS terminal — super admin only"
            >
              <ShoppingCart size={14} />
              Open Classic POS
            </button>
          )}
        </div>
      </div>

      {/* Stat cards row — live counters for the counter desk */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
          <p className="text-2xl font-black text-orange-600">{lowStockCount}</p>
          <p className="text-xs font-semibold text-slate-600 mt-0.5">Low-stock medicines</p>
          <button
            type="button"
            onClick={() => setDeskModal("low-stock")}
            className="mt-2 self-end w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
            title="View low-stock medicines"
          >
            <ArrowRight size={13} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
          <p className="text-2xl font-black text-emerald-700">{rxTodayCount}</p>
          <p className="text-xs font-semibold text-slate-600 mt-0.5">Prescriptions filled today</p>
          <button
            type="button"
            onClick={() => setDeskModal("rx-today")}
            className="mt-2 self-end w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
            title="View prescriptions filled today"
          >
            <ArrowRight size={13} />
          </button>
        </div>

        {/* Free hand-outs today — samples and staff medicine only. A paid OTC
            sale is billed, so it counts under sales, not here. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
          <p className="text-2xl font-black text-emerald-700">{otcToday.supplies}</p>
          <p className="text-xs font-semibold text-slate-600 mt-0.5">
            Free hand-outs (no bill)
            {otcToday.units > 0 && (
              <span className="ml-1 text-[10px] font-bold text-slate-400">({otcToday.units} units)</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setDeskModal("otc-today")}
            className="mt-2 self-end w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
            title="View free hand-outs recorded today"
          >
            <ArrowRight size={13} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
          <p className="text-2xl font-black text-emerald-700">{visitedByDoctors}</p>
          <p className="text-xs font-semibold text-slate-600 mt-0.5">Patients visited by doctors</p>
          <button
            type="button"
            onClick={() => setDeskModal("patients-visited")}
            className="mt-2 self-end w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
            title="View patients visited by doctors"
          >
            <ArrowRight size={13} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
          {ongoingToken ? (
            <>
              <p className="font-bold text-slate-900 text-sm truncate">{ongoingToken.patient?.name ?? "—"}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                Ongoing · {docDisplay(ongoingToken)}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                  Token {ongoingToken.tokenNo}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Last {Math.max(1, minutesSince(ongoingToken.calledAt))} minute{minutesSince(ongoingToken.calledAt) === 1 ? "" : "s"}
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="text-2xl font-black text-slate-300">—</p>
              <p className="text-xs font-semibold text-slate-600 mt-0.5">No consultation ongoing</p>
              <span className="mt-2 self-end flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <Clock size={11} /> idle
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => setDeskModal("ongoing")}
            className="mt-2 self-end w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
            title="View ongoing consultation"
          >
            <ArrowRight size={13} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
          {nextToken ? (
            <>
              <p className="font-bold text-slate-900 text-sm truncate">{nextToken.patient?.name ?? "—"}</p>
              <p className="text-[11px] text-emerald-600 mt-0.5 truncate font-semibold">Next appointment</p>
              <div className="mt-2 flex items-center justify-between gap-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                  Token {nextToken.tokenNo}
                </span>
                <span className="text-[10px] text-slate-400 font-medium truncate">
                  {nextToken.timeSlot ? `${nextToken.timeSlot} · ` : ""}{docDisplay(nextToken)}
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="text-2xl font-black text-slate-300">—</p>
              <p className="text-xs font-semibold text-slate-600 mt-0.5">No pending appointments</p>
              <span className="mt-2 self-end flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <Ticket size={11} /> queue clear
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => setDeskModal("next")}
            className="mt-2 self-end w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors"
            title="View next appointment"
          >
            <ArrowRight size={13} />
          </button>
        </div>
      </div>

      {/* Journey card: patient search -> patient card -> path -> path content.
          An OTC counter sale takes the card over while it runs — the counter
          searches on the left and watches the bill grow on the right, in the
          same viewport, rather than through a dialog that hides the desk. */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {otcSupplyTarget ? (
          <div className="p-5">
            <OtcCounterSale
              medicine={otcSupplyTarget}
              onClose={() => setOtcSupplyTarget(null)}
            />
          </div>
        ) : !cart.patientId ? (
          <div className="p-6">
            {registering ? (
              <QuickPatientForm
                initialQuery={query}
                onCreated={(p: QuickPatient) => {
                  setRegistering(false);
                  selectPatient(p.id, p.name);
                }}
                onCancel={() => setRegistering(false)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-black flex items-center justify-center">1</span>
                  <p className="text-sm font-bold text-slate-800">Who is being served?</p>
                </div>
                <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    {/* One box, three kinds of input: a mobile number, a patient
                        name, a medicine. inputMode="tel" opened a number pad on
                        phones and in the installed PWA, which cannot type either
                        of the other two — the text keyboard is the only one that
                        serves all three, and digits are one tap away on it. */}
                    <input
                      ref={searchInputRef}
                      autoFocus
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setShowResults(false);
                      }}
                      placeholder="Search patient by mobile / name, or medicine…"
                      type="search"
                      enterKeyHint="search"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full border-2 border-slate-200 rounded-full pl-11 pr-11 py-3 text-sm font-medium bg-white focus:outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {/* WebKit's own clear button is suppressed above (it breaks
                        the pill), and on the desk the counter needs one tap to
                        wipe a half-typed name and the stale results under it. */}
                    {query.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setSubmitted("");
                          setShowResults(false);
                          searchInputRef.current?.focus();
                        }}
                        title="Clear the search"
                        aria-label="Clear the search"
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      type="submit"
                      disabled={query.trim().length < 3}
                      className="flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                      {isFetching ? (
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Search size={14} />
                      )}
                      Search
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegistering(true)}
                      className="flex items-center gap-2 px-6 py-3 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-all shadow-sm"
                    >
                      <UserPlus size={14} />
                      + Add New
                    </button>
                  </div>
                </form>

                {/* Idle-state briefing: doctors + their usual meds on the
                    left, the day's billings on the right. Two columns on wide
                    screens so both stay visible without pushing the search UI
                    down; single column and stacked on tablet/mobile. Each
                    panel scrolls internally so the outer card keeps a bounded
                    height regardless of doctor count or served-today count. */}
                {!showResults && !searchActive && !registering && (doctors.length > 0 || servedToday.length > 0) && (
                  <div
                    className={`mt-4 grid gap-4 ${
                      doctors.length > 0 && servedToday.length > 0
                        ? "lg:grid-cols-3"
                        : "grid-cols-1"
                    }`}
                  >
                    {doctors.length > 0 && (
                      <div className={servedToday.length > 0 ? "lg:col-span-2" : ""}>
                        <DoctorsOverview
                          doctors={doctors}
                          branchId={activeBranchId}
                          onAddMedicine={addDoctorMedicineFromOverview}
                          addingId={medLoadingId}
                          onOpenDoctor={(doc) => setBrowsingDoctor(doc)}
                          onManageMedicines={canManageDoctorLists ? (doc) => setManagingMedicinesFor(doc) : undefined}
                        />
                      </div>
                    )}
                    {servedToday.length > 0 && (
                      <div className={doctors.length > 0 ? "lg:col-span-1" : ""}>
                        <p className="px-1 mb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Clock size={11} /> Today&apos;s billings ({servedToday.length})
                        </p>
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-[440px] overflow-y-auto">
                          {servedToday.map((inv: any) => {
                            const servedPatientId = inv?.patientId;
                            const servedName = inv?.patientName ?? "Walk-in";
                            return (
                              // Two actions, because the row has two honest
                              // meanings: look at the bill, and pick the patient
                              // back up. It used to only do the second, so a
                              // walk-in row — which has no patient — rendered
                              // disabled and clicking the bill did nothing. Most
                              // OTC sales are walk-ins, so that was the whole
                              // list greyed out.
                              <div
                                key={inv.id}
                                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-orange-50/60 transition-colors"
                              >
                                <button
                                  type="button"
                                  onClick={() => setOpenInvoiceId(inv.id)}
                                  title={`Open bill ${inv?.invoiceNo ?? ""}`}
                                  className="flex-1 flex items-center justify-between gap-3 text-left min-w-0"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0 border border-slate-200">
                                      {servedName.slice(0, 1).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[13px] font-bold text-slate-800 truncate">{servedName}</p>
                                      <p className="text-[11px] text-slate-400 font-mono truncate">{inv?.invoiceNo}</p>
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold text-slate-700">₹{Number(inv?.totalAmount ?? 0).toFixed(2)}</p>
                                    <p className="text-[10px] text-slate-400">{formatTime(inv?.createdAt)}</p>
                                  </div>
                                </button>
                                {servedPatientId && (
                                  <button
                                    type="button"
                                    onClick={() => selectPatient(servedPatientId, servedName)}
                                    title={`Serve ${servedName} again`}
                                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-100 transition-colors"
                                  >
                                    <UserPlus size={14} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(showResults || searchActive) && (
                  <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
                    {(submitted || searchActive) && (
                      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-slate-500">
                          Results for{" "}
                          <span className="font-extrabold text-slate-800">
                            &ldquo;{submitted || query}&rdquo;
                          </span>
                        </p>
                        <span className="text-[10px] font-bold text-slate-400 shrink-0">
                          {patients.length + medResults.length} match{patients.length + medResults.length !== 1 ? "es" : ""}
                        </span>
                      </div>
                    )}
                    {(isFetching || medSearching) && (
                      <div className="p-4 text-xs text-slate-400 text-center animate-pulse">Searching patients and medicines…</div>
                    )}

                    {!isFetching && !medSearching && patients.length === 0 && medResults.length === 0 && (
                      <div className="p-6 text-center">
                        <AlertCircle size={20} className="mx-auto text-slate-300" />
                        <p className="mt-2 text-sm font-semibold text-slate-600">
                          Nothing found for &ldquo;{submitted || query}&rdquo;
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          No matching patient or medicine. Register the patient
                          with <strong>+ Add New</strong>.
                        </p>
                        {canAddMedicine && (
                          <button
                            type="button"
                            onClick={() => setNewMedicineName((submitted || query).trim())}
                            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
                            title="Register this medicine in the catalogue without leaving the counter"
                          >
                            <Plus size={13} strokeWidth={3} />
                            Add &ldquo;{(submitted || query).trim()}&rdquo; to catalogue
                          </button>
                        )}
                      </div>
                    )}

                    {/* Patients group */}
                    {patients.length > 0 && (
                      <div className="divide-y divide-slate-100">
                        <p className="px-4 py-1.5 bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center gap-1.5">
                          <Users size={11} /> Patients
                        </p>
                        {patients.map((p: any) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectPatient(p.id, p.name)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-50/60 transition-colors text-left group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-slate-100 group-hover:bg-white flex items-center justify-center text-sm font-bold text-slate-600 shrink-0 border border-slate-200">
                                {(p.name ?? "?").slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{p.name}</p>
                                <p className="text-xs text-slate-400 font-mono flex items-center gap-1">
                                  <Phone size={10} /> {p.phone}
                                </p>
                              </div>
                            </div>
                            <span className="flex items-center gap-1.5 text-xs font-bold text-orange-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              Select <ArrowRight size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Searched a medicine name the catalogue has never seen —
                        offer to register it instead of sending staff to the
                        Inventory module and back. The both-empty case is
                        already covered by the "Nothing found" panel above. */}
                    {!isFetching && !medSearching && patients.length > 0 && medResults.length === 0 && canAddMedicine && (
                      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
                        <p className="text-xs text-slate-500 min-w-0">
                          No medicine matches{" "}
                          <span className="font-bold text-slate-700">&ldquo;{submitted || query}&rdquo;</span>.
                        </p>
                        <button
                          type="button"
                          onClick={() => setNewMedicineName((submitted || query).trim())}
                          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors shadow-sm"
                        >
                          <Plus size={12} strokeWidth={3} />
                          Add medicine
                        </button>
                      </div>
                    )}

                    {/* Medicines group — OTC counter sale (billed by default) */}
                    {medResults.length > 0 && (
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        <p className="px-4 py-1.5 bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center gap-1.5">
                          <Pill size={11} /> Medicines
                        </p>
                        {medResults.map((m: any) => (
                          <div
                            key={m.id}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50/40 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-slate-800 truncate">{m.name}</p>
                              <p className="text-xs text-slate-400 font-mono truncate">
                                {m.sku}
                                {m.scheduleClass ? ` · ${m.scheduleClass}` : ""}
                              </p>
                            </div>
                            {/* Stock gets its own fixed column so the sale
                                buttons line up down the list instead of
                                shuffling left and right with the length of
                                "Out of stock" — and out of stock reads as a
                                warning, not as a quantity. */}
                            <span
                              className={`w-20 sm:w-36 shrink-0 text-right text-[11px] font-semibold leading-tight ${
                                Number(m.totalStock || 0) > 0 ? "text-emerald-700" : "text-rose-600"
                              }`}
                            >
                              {formatStockUnit(Number(m.totalStock || 0), m)}
                            </span>
                            {(() => {
                              // Nothing on the shelf means nothing to sell, so
                              // the sale button is dropped entirely rather than
                              // shown greyed out — the row offers the one action
                              // that actually helps: receiving a batch.
                              const outOfStock = Number(m.totalStock || 0) <= 0;
                              return (
                                // Two fixed action slots keep every row's
                                // buttons on the same two vertical lines, no
                                // matter which of them a row happens to show.
                                <div className="flex items-center justify-end gap-2 shrink-0">
                                  <div className="w-[104px] shrink-0 flex justify-end">
                                    {outOfStock
                                      ? canAddStock && (
                                          <button
                                            type="button"
                                            onClick={() => setStockTarget(m)}
                                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
                                            title={`Receive a new batch of ${m.name} into this branch`}
                                          >
                                            <PackagePlus size={12} />
                                            Add stock
                                          </button>
                                        )
                                      : canOtc && (
                                          <button
                                            type="button"
                                            onClick={() => setOtcSupplyTarget(m)}
                                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                            title="Sell over the counter without a prescription — bills it, or record a free hand-out"
                                          >
                                            <Plus size={12} strokeWidth={3} />
                                            OTC sale
                                          </button>
                                        )}
                                  </div>
                                  {/* Trailing slot: the quiet top-up on a
                                      stocked row. Held open as a spacer on the
                                      empty row so the primary buttons stay
                                      aligned column-to-column. */}
                                  <div className="w-7 h-7 shrink-0 flex items-center justify-center">
                                    {!outOfStock && canAddStock && (
                                      <button
                                        type="button"
                                        onClick={() => setStockTarget(m)}
                                        className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-colors hover:text-orange-600 hover:border-orange-300 hover:bg-orange-50"
                                        title="Add stock — receive another batch"
                                      >
                                        <PackagePlus size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="p-6">
            {/* Patient card */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black text-sm shrink-0">
                  {(selectedPatient?.name ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-sm truncate">{selectedPatient?.name ?? "Patient"}</p>
                  <p className="text-xs text-slate-500 font-mono truncate">{selectedPatient?.phone ?? ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {cart.items.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-white border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                    {cart.items.length} item{cart.items.length !== 1 ? "s" : ""} in bill
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearPatient}
                  className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
                >
                  Change patient
                </button>
              </div>
            </div>

            {/* Step 2 — path selection */}
            {!path && (
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-black flex items-center justify-center">2</span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">What does {selectedPatient?.name?.split(" ")[0] ?? "the patient"} need today?</p>
                    <p className="text-xs text-slate-400">Choose the fastest path for this visit</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => startPath("prescription")}
                    className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-emerald-400 hover:bg-emerald-50/40 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
                      <FileText size={18} />
                    </div>
                    <p className="mt-3 font-bold text-slate-800 text-sm">Fill a prescription</p>
                    <p className="mt-1 text-xs text-slate-500">Verify a doctor&apos;s Rx and dispense its medicines.</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                      Start dispensing <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => startPath("doctor")}
                    className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-purple-400 hover:bg-purple-50/40 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700">
                      <Stethoscope size={18} />
                    </div>
                    <p className="mt-3 font-bold text-slate-800 text-sm">Book a doctor</p>
                    <p className="mt-1 text-xs text-slate-500">Choose an available in-store doctor; consultation fee is added to the bill.</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-purple-600">
                      View doctors <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => startPath("otc")}
                    className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-orange-400 hover:bg-orange-50/40 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-700">
                      <Pill size={18} />
                    </div>
                    <p className="mt-3 font-bold text-slate-800 text-sm">OTC medicine</p>
                    <p className="mt-1 text-xs text-slate-500">Sell over-the-counter medicines straight from the counter.</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-orange-600">
                      Search medicines <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 content — prescription path */}
            {path === "prescription" && (
              <div className="mt-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-black flex items-center justify-center">2</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">Fill a prescription</p>
                      <p className="text-xs text-slate-400">Verified prescriptions for {selectedPatient?.name ?? "this patient"}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPath(null)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    <X size={13} /> Back to paths
                  </button>
                </div>

                {rxFetching ? (
                  <div className="space-y-2.5">
                    {[1, 2].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
                  </div>
                ) : rxList.length === 0 ? (
                  <div className="py-10 text-center">
                    <FileText size={28} className="mx-auto text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-600">No verified prescriptions found</p>
                    <p className="text-xs text-slate-400 mt-1">Does the patient have a paper Rx? Log it in the POS, or pick another path.</p>
                    <button
                      type="button"
                      onClick={() => setPath(null)}
                      className="mt-3 px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
                    >
                      Choose another path
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {rxList.map((rx: any) => (
                      <button
                        key={rx.id}
                        type="button"
                        disabled={rxLoadingId === rx.id}
                        onClick={() => loadRxIntoCart(rx)}
                        className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-400 hover:bg-emerald-50/40 transition-all disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">
                              #{rx.prescriptionNumber ?? rx.id.slice(0, 8)}
                              <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">Verified</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                              {rx.doctorName ? `Dr. ${rx.doctorName}` : "Doctor"} ·{" "}
                              {rx.createdAt
                                ? new Date(rx.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                                : ""}
                            </p>
                          </div>
                          {rxLoadingId === rx.id ? (
                            <span className="w-4 h-4 border-2 border-emerald-300 border-t-emerald-700 rounded-full animate-spin shrink-0" />
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 shrink-0">
                              Dispense <ArrowRight size={13} />
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2 content — doctor path. Two things live here: booking a
                consultation, and looking at what a doctor prescribes. The
                medicine list takes over the panel when a doctor is opened. */}
            {path === "doctor" && medsForDoctor && (
              <DoctorMedicinesPanel
                doctor={medsForDoctor}
                branchId={activeBranchId}
                onAdd={addDoctorMedicineToCart}
                addingId={medLoadingId}
                onBack={() => setMedsForDoctor(null)}
              />
            )}

            {path === "doctor" && !medsForDoctor && (
              <div className="mt-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-[11px] font-black flex items-center justify-center">2</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">Book a doctor</p>
                      <p className="text-xs text-slate-400">Consultation fee is added to the bill, or open a doctor to see what they prescribe</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPath(null)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    <X size={13} /> Back to paths
                  </button>
                </div>

                {doctors.length === 0 ? (
                  <div className="py-10 text-center">
                    <Stethoscope size={28} className="mx-auto text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-600">No doctors available today</p>
                    <p className="text-xs text-slate-400 mt-1">Choose another path or check the clinic queue.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {doctors.map((doc: any) => {
                      const dp = doc?.doctorProfile;
                      const fee = Number(dp?.consultationFee ?? 400);
                      const name = [doc.firstName, doc.lastName].filter(Boolean).join(" ") || doc.email || "Doctor";
                      return (
                        // A card, not a button: it carries two independent
                        // actions and nesting buttons is invalid markup.
                        <div
                          key={doc.id}
                          className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-purple-400 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-black text-sm shrink-0">
                              {name.replace("Dr. ", "").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
                              <p className="text-xs text-slate-500 truncate">{dp?.specialty ?? "General Medicine"}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-xs text-slate-500 font-medium">{dp?.opdRoom ?? "OPD"}</span>
                            <span className="text-sm font-black text-slate-900">₹{fee.toFixed(0)}</span>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setMedsForDoctor(doc)}
                              className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-2.5 py-2 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors"
                            >
                              <Pill size={13} /> Medicines
                            </button>
                            <button
                              type="button"
                              disabled={tokenLoadingId === doc.id}
                              onClick={() => bookDoctor(doc)}
                              className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-2.5 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 transition-colors"
                            >
                              {tokenLoadingId === doc.id ? (
                                <>
                                  <span className="w-3 h-3 border-2 border-purple-300 border-t-white rounded-full animate-spin" />
                                  Issuing…
                                </>
                              ) : (
                                <>
                                  Book <ArrowRight size={13} />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 2 content — OTC path */}
            {path === "otc" && (
              <div className="mt-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-[11px] font-black flex items-center justify-center">2</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">OTC medicine</p>
                      <p className="text-xs text-slate-400">Search and add medicines to the bill</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPath(null)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    <X size={13} /> Back to paths
                  </button>
                </div>

                <div className="relative">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    value={medicineSearch}
                    onChange={(e) => setMedicineSearch(e.target.value)}
                    placeholder="Search medicines by name, SKU or barcode…"
                    className="w-full border-2 border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm bg-white focus:outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all"
                  />
                </div>

                <div className="mt-3 space-y-2">
                  {medsFetching && <div className="p-4 text-xs text-slate-400 text-center animate-pulse">Searching catalog…</div>}
                  {!medsFetching && meds.length === 0 && debouncedMeds.trim().length >= 2 && (
                    <div className="p-6 text-center text-xs text-slate-400">No medicines matched. Try a different name.</div>
                  )}
                  {meds.map((m: any) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-orange-300 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {m.name}
                          {m.isActive === false && (
                            <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 font-extrabold px-1.5 py-0.2 rounded border border-amber-200">
                              Inactive
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 font-mono truncate">
                          {m.sku} · {formatStockUnit(remainingStock(m), m)}
                          {inBillPacks(m) > 0 && (
                            <span className="ml-1 text-orange-600 font-bold">
                              · {inBillPacks(m)} in bill
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-black text-slate-900">₹{parseFloat(m.priceMrp ?? "0").toFixed(2)}</span>
                        <button
                          type="button"
                          disabled={medLoadingId === m.id}
                          onClick={() => addMedicineToCart(m)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold disabled:opacity-60 transition-colors"
                        >
                          {medLoadingId === m.id ? (
                            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <Plus size={12} />
                          )}
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 3 — bill summary + hand off to POS */}
      {cart.patientId && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-black flex items-center justify-center">3</span>
              <p className="text-sm font-bold text-slate-800">Bill summary</p>
              {!path && cart.items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPath("otc")}
                  className="text-[11px] font-bold text-orange-600 hover:text-orange-700 flex items-center gap-0.5"
                >
                  <Plus size={11} /> Add more
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { cart.clear(); setPath(null); }}
              className="text-xs font-semibold text-slate-400 hover:text-rose-600 flex items-center gap-1"
            >
              <RefreshCw size={12} /> Clear bill
            </button>
          </div>

          {!hasCart ? (
            <div className="p-6 text-center">
              <LayoutList size={26} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-500">No items yet</p>
              <p className="text-xs text-slate-400 mt-0.5">Pick a path above to add medicines or a consultation.</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 space-y-2 divide-y divide-slate-50 max-h-64 overflow-y-auto">
                {cart.consultationFee && (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">Doctor consultation</p>
                      <p className="text-xs text-slate-400 truncate">{cart.consultationFee.doctorName} · GST-exempt</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-slate-900">₹{cart.consultationFee.amount.toFixed(2)}</span>
                      <button
                        type="button"
                        onClick={() => cart.setConsultationFee(null)}
                        className="text-slate-300 hover:text-rose-500 transition-colors"
                        title="Remove consultation fee"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {cartItems.map((item) => {
                  // Per-line discount context for the operator: shows what the
                  // shopkeeper is knocking off this specific medicine before
                  // GST is applied. Same math as pos-terminal.tsx.
                  const unitPrice = item.saleUnit === "loose" ? item.unitPrice / (item.stripSize || 1) : item.unitPrice;
                  const gross = unitPrice * item.quantity;
                  const discAmt = (gross * (item.discountPct || 0)) / 100;
                  return (
                  <div key={item.batchId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {item.saleUnit === "loose" ? `${item.quantity} loose` : `${item.quantity} × ${item.saleUnit}`} · {item.taxPct > 0 ? `${item.taxPct}% GST` : "No GST"}
                        {discAmt > 0 && <span className="text-purple-600 font-semibold"> · −₹{discAmt.toFixed(2)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-1 py-0.5">
                        <button
                          type="button"
                          onClick={() => cart.updateQty(item.medicineId, item.batchId, item.quantity - 1)}
                          className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-900"
                        >
                          <Minus size={11} />
                        </button>
                        <span className="text-xs font-bold text-slate-800 w-5 text-center">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => cart.updateQty(item.medicineId, item.batchId, item.quantity + 1)}
                          className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-900"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-1.5 py-0.5" title="Discount % on this medicine — applied before GST">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={item.discountPct}
                          onChange={(e) => cart.updateDiscountPct(item.medicineId, item.batchId, parseFloat(e.target.value) || 0)}
                          className="w-10 text-xs font-mono font-bold text-center focus:outline-none bg-transparent"
                        />
                        <span className="text-[10px] text-slate-400 font-bold">%</span>
                      </div>
                      <span className="text-sm font-bold text-slate-900 w-16 text-right">₹{item.lineTotal.toFixed(2)}</span>
                      <button
                        type="button"
                        onClick={() => cart.removeItem(item.medicineId, item.batchId)}
                        className="text-slate-300 hover:text-rose-500 transition-colors"
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-4 text-sm flex-wrap">
                    <span className="text-slate-500">
                      Subtotal <b className="text-slate-800">₹{totals.subtotal.toFixed(2)}</b>
                    </span>
                    {totals.discount > 0 && (
                      <span className="text-purple-600 font-semibold" title="Sum of all per-medicine discounts">
                        Discount <b>−₹{totals.discount.toFixed(2)}</b>
                      </span>
                    )}
                    <span className="text-slate-500">
                      Tax <b className="text-slate-800">₹{totals.tax.toFixed(2)}</b>
                    </span>
                    <span className="text-base font-black text-slate-900 flex items-center gap-1">
                      <IndianRupee size={15} /> {totals.total.toFixed(2)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={continueToPayment}
                    className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
                  >
                    <CheckCircle2 size={15} />
                    Continue to payment
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Stock allocation, payment and printing happen in the POS terminal. Your bill carries over automatically.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Restock a medicine that ran out, without leaving the counter. Opens
          straight into the receive-batch form; the counter search is refreshed
          on close so the row's stock count and its OTC button catch up. */}
      <MedicineStockModal
        open={!!stockTarget}
        onClose={() => {
          setStockTarget(null);
          refreshMedicineSearch();
        }}
        medicineId={stockTarget?.id ?? null}
        medicineName={stockTarget?.name}
        autoOpenAddStock
      />

      {/* Register a medicine the catalogue has never seen. Defaults to
          prescription-required, same fail-safe the barcode-scan add uses: a
          rushed entry must not register a Schedule H drug as OTC and slip past
          the Rx gate. The manager unticks it for a genuine OTC item. */}
      <Modal
        title="Add New Medicine"
        subtitle={
          newMedicineName
            ? `"${newMedicineName}" isn't in the catalogue yet — enter price and GST to register it.`
            : undefined
        }
        icon={<Pill size={16} />}
        open={!!newMedicineName}
        onClose={() => setNewMedicineName(null)}
        size="xl"
      >
        {newMedicineName && (
          <>
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-bold shrink-0">Schedule check:</span>
              <span>
                This item defaults to <b>prescription required</b>. If it is a Schedule H / H1 / X drug,
                set the correct schedule class below. If it is genuinely OTC, untick &ldquo;Requires Prescription&rdquo;.
              </span>
            </div>
            <MedicineForm
              initial={{
                name: newMedicineName,
                unit: "strip",
                stripSize: 1,
                taxPercent: "12",
                reorderLevel: 10,
                reorderQty: 50,
                requiresPrescription: true,
                isControlled: false,
                isActive: true,
              } as any}
              onSuccess={() => {
                setNewMedicineName(null);
                refreshMedicineSearch();
                toastSuccess(
                  "Medicine added",
                  "It is in the catalogue now. Add a batch before selling it — the search row has an Add stock button.",
                );
              }}
              onCancel={() => setNewMedicineName(null)}
            />
          </>
        )}
      </Modal>

      {/* Stat-card drill-down modals — never leave the desk */}
      <CounterDeskModals view={deskModal} onClose={() => setDeskModal(null)} />

      {/* A bill opened from a stat card or the day's billings list */}
      {openInvoiceId && (
        <InvoiceDetailModal
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
        />
      )}

      {/* Browse a doctor's full list from the top-of-page overview. Deliberately
          patient-free: an operator can eyeball the list before deciding whether
          to register the patient. addDoctorMedicineFromOverview still guards
          the actual add, so opening never leaks into an orphan cart. */}
      {browsingDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <DoctorMedicinesPanel
                doctor={browsingDoctor}
                branchId={activeBranchId}
                onAdd={addDoctorMedicineFromOverview}
                addingId={medLoadingId}
                onBack={() => setBrowsingDoctor(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Inactive medicine MRP edit — set price and reactivate before adding to cart */}
      <Modal
        title="Set MRP & Activate"
        subtitle={inactiveMrpTarget ? `"${inactiveMrpTarget.name}" is currently inactive — enter its MRP to make it sellable.` : undefined}
        open={!!inactiveMrpTarget}
        onClose={() => { setInactiveMrpTarget(null); setInactiveMrpValue(""); setInactiveMrpError(null); }}
        size="sm"
      >
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            This medicine has no MRP set, so it cannot be sold. Enter the MRP below to activate it and add it to the bill.
          </p>
          <div className="space-y-1">
            <label className="text-sm font-semibold">MRP (INR) <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={inactiveMrpValue}
                onChange={(e) => { setInactiveMrpValue(e.target.value); setInactiveMrpError(null); }}
                placeholder="e.g. 85.50"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && inactiveMrpValue && !inactiveMrpLoading) confirmInactiveMrp(); }}
                className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>
          {inactiveMrpError && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {inactiveMrpError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setInactiveMrpTarget(null); setInactiveMrpValue(""); setInactiveMrpError(null); }}
              className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmInactiveMrp}
              disabled={!inactiveMrpValue || inactiveMrpLoading}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {inactiveMrpLoading ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Activating…</>
              ) : (
                <>Set MRP & Add to Bill</>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Curate a doctor's medicine list from the overview strip. Only
          admins/shop managers may edit — doctors see a read-only view. */}
      {managingMedicinesFor && (
        <DoctorMedicineManager
          open
          onClose={() => setManagingMedicinesFor(null)}
          doctorId={managingMedicinesFor.id}
          doctorName={[managingMedicinesFor.firstName, managingMedicinesFor.lastName].filter(Boolean).join(" ") || managingMedicinesFor.email || "Doctor"}
          branchId={activeBranchId}
          canEdit={canManageDoctorLists}
        />
      )}
    </div>
  );
}
