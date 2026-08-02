# Doctor Panel & Clinic Token Queuing System

Implement a clinic token queuing and consultation management system. This feature comprises a token generation panel (for cashiers/receptionists) and a doctor dashboard (for clinic doctors) that allows queue management, viewing patient history, writing inventory-linked prescriptions, and uploading prescription scans.

## User Review Required

> [!IMPORTANT]
> **Database Schema Updates & Migrations**:
> * We are adding `"doctor"` to the `user_role` pgEnum.
> * We are introducing a new `clinic_tokens` table.
> * Running `pnpm --filter backend drizzle-kit generate` and `pnpm --filter backend drizzle-kit push` (or `db:push`) is required to update the PostgreSQL schema.
> * We will add a database seed update or helper script to create/assign the `"doctor"` role to select users.

> [!NOTE]
> **Prescription Status & Verification**:
> * Currently, all prescriptions are created with `status = "pending_verification"` (requiring a pharmacist to verify them).
> * For prescriptions created *directly* by a Doctor inside the Doctor Panel, we will auto-approve them (`status = "verified"`), while uploaded scans/handwritten prescriptions will default to `pending_verification`.

---

## Open Questions

> [!IMPORTANT]
> We would appreciate your feedback on the following design choices (please feel free to reply directly or select from these choices during review):
> 1. **Daily Reset of Tokens**: Do clinic tokens reset every day (e.g. Doctor A gets Token #1, #2... starting fresh each morning)?
>    * *Recommended approach*: Yes, resetting daily per doctor is standard clinic behavior.
> 2. **Staff Role for Token Generation**: Should cashier, admin, and superadmin users be the only ones allowed to generate tokens, or do we need a separate "receptionist" role?
>    * *Recommended approach*: Leverage cashier/admin roles for token generation to avoid creating an entirely new role for now.

---

## Proposed Changes

### Database Layer

#### [MODIFY] [enums.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/database/schema/enums.ts)
* Add `"doctor"` to `userRoleEnum`.
* Add `tokenStatusEnum = pgEnum("token_status", ["pending", "called", "completed", "cancelled"])`.

#### [NEW] [clinic.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/database/schema/clinic.ts)
Create a new file defining the database model for clinic tokens:
```typescript
import { pgTable, uuid, integer, timestamp, text, date, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tokenStatusEnum } from "./enums";
import { patients } from "./billing";
import { users } from "./auth";
import { prescriptions } from "./prescriptions";

export const clinicTokens = pgTable("clinic_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenNo: integer("token_no").notNull(),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  doctorId: uuid("doctor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  timeSlot: varchar("time_slot", { length: 50 }),
  status: tokenStatusEnum("status").notNull().default("pending"),
  prescriptionId: uuid("prescription_id").references(() => prescriptions.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clinicTokensRelations = relations(clinicTokens, ({ one }) => ({
  patient: one(patients, { fields: [clinicTokens.patientId], references: [patients.id] }),
  doctor: one(users, { fields: [clinicTokens.doctorId], references: [users.id] }),
  prescription: one(prescriptions, { fields: [clinicTokens.prescriptionId], references: [prescriptions.id] }),
}));
```

#### [MODIFY] [index.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/database/schema/index.ts)
* Export all variables from `./clinic`.

---

### Shared Type Layer

#### [MODIFY] [enums.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/packages/types/src/enums.ts)
* Add `DOCTOR: "doctor"` to the `UserRole` constant object.
* Add `TokenStatus` object and type:
  ```typescript
  export const TokenStatus = {
    PENDING: "pending",
    CALLED: "called",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  } as const;
  export type TokenStatus = typeof TokenStatus[keyof typeof TokenStatus];
  ```

#### [NEW] [clinic.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/packages/types/src/dtos/clinic.ts)
Define request/response validation schemas for clinic tokens:
```typescript
import { z } from "zod";

export const createClinicTokenSchema = z.zobject({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format"),
  timeSlot: z.string().optional(),
  notes: z.string().optional(),
});

export const updateClinicTokenSchema = z.zobject({
  status: z.enum(["pending", "called", "completed", "cancelled"]).optional(),
  notes: z.string().optional(),
  prescriptionId: z.string().uuid().optional(),
});

export const queryClinicTokenSchema = z.zobject({
  date: z.string().optional(),
  doctorId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  status: z.enum(["pending", "called", "completed", "cancelled"]).optional(),
});

export type CreateClinicTokenDto = z.infer<typeof createClinicTokenSchema>;
export type UpdateClinicTokenDto = z.infer<typeof updateClinicTokenSchema>;
export type QueryClinicTokenDto = z.infer<typeof queryClinicTokenSchema>;
```

#### [MODIFY] [index.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/packages/types/src/index.ts)
* Export the clinic schemas and types.

---

### Backend Logic (NestJS)

#### [NEW] [clinic.module.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/clinic/clinic.module.ts)
Wire up the clinic module.

#### [NEW] [clinic.repository.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/clinic/clinic.repository.ts)
Drizzle queries:
* `findMany(query)`: Paginate and filter clinic tokens.
* `findById(id)`: Load token details along with Patient profile and Prescription.
* `create(data)`: Retrieve the highest token number for the doctor on that date, increment by 1, and insert.
* `update(id, data)`: Update status, note, or prescription link.
* `findDoctors()`: Query users whose `role = 'doctor'` and are active.

#### [NEW] [clinic.service.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/clinic/clinic.service.ts)
Main clinic logic (token increments, status workflow validation).

#### [NEW] [clinic.controller.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/clinic/clinic.controller.ts)
Provide API routes:
* `POST /clinic/tokens` (Create token)
* `GET /clinic/tokens` (Query queue)
* `GET /clinic/tokens/:id` (Get specific token details)
* `PATCH /clinic/tokens/:id` (Update token status)
* `GET /clinic/doctors` (Fetch list of available doctors for allocation)

#### [MODIFY] [app.module.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/app.module.ts)
* Import `ClinicModule`.

#### [MODIFY] [inventory.controller.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/inventory/inventory.controller.ts) & [patients.controller.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/patients/patients.controller.ts) & [prescriptions.controller.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/backend/src/modules/prescriptions/prescriptions.controller.ts)
* Add `"doctor"` to `@Roles()` guards for searching medicines, querying patients, and creating prescriptions.

---

### Frontend UI Component Layer

#### [MODIFY] [use-permissions.ts](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/frontend/hooks/use-permissions.ts)
* Define new actions `"clinic.tokens"` and `"clinic.doctor"`.
* Give `doctor` role access to `"patients.write"`, `"prescriptions.verify"`, and `"clinic.doctor"`.
* Give `cashier`/`admin` access to `"clinic.tokens"`.

#### [MODIFY] [sidebar.tsx](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/frontend/components/shared/sidebar.tsx)
* Add a navigation item `/clinic/queue` (for generating tokens, permission: `clinic.tokens`).
* Add a navigation item `/clinic/doctor` (the doctor panel, permission: `clinic.doctor`).

#### [NEW] [clinic-queue.tsx](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/frontend/components/modules/clinic/clinic-queue.tsx)
The page for billing/cashier/reception staff:
* List of current day's generated clinic tokens with search and filter.
* "New Token" button opening a modal:
  * Select or search/register patient.
  * Dropdown to select a Doctor.
  * Select Date & Time slot (defaults to current date/time).
  * Auto-assign token number and print/display details.

#### [NEW] [doctor-panel.tsx](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/frontend/components/modules/clinic/doctor-panel.tsx)
The Doctor workspace containing:
1. **Queue List**: Shows doctor's pending, called, and completed tokens for today.
2. **Current Token Workspace**:
   * Patient Info Panel: Displays allergies, age, gender, notes.
   * **History Panel**: Pulls and lists previous prescriptions (including item names, frequencies) and past billing logs in a clean tab.
   * **Prescription Form**: An inline form to write a new prescription:
     * Search medicine in the inventory (autocomplete dropdown).
     * Add multiple medicines with dosage, frequency, and duration inputs.
     * Select if it's a controlled drug.
   * **Scan/Upload Panel**: Allows drag-and-drop or camera capture input. Uploads the prescription scan to minio/S3 and saves the URL.
   * **Complete Consultation Button**: Submits the prescription, links it to the token, and marks the token as `completed`.

#### [NEW] [queue/page.tsx](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/frontend/app/(shell)/clinic/queue/page.tsx) & [doctor/page.tsx](file:///c:/Users/soumi/Desktop/Pharma-Medical-ERP/frontend/app/(shell)/clinic/doctor/page.tsx)
* Next.js pages hosting `<ClinicQueue />` and `<DoctorPanel />`.

---

## Verification Plan

### Automated Tests
* Create unit tests for repository & service token generation in `backend/src/modules/clinic/__tests__/clinic.service.spec.ts`.
* Run test suite:
  ```bash
  pnpm run test
  ```

### Manual Verification
* Run dev environment:
  ```bash
  pnpm run dev
  ```
* Log in as an admin/cashier to create a patient token for a designated doctor.
* Log in as a doctor to view the token list, call the patient, verify their history is populated, search medicines to write a prescription, upload a sample prescription image, and submit.
* Log in as a pharmacist to verify the prescription has been logged successfully in the main prescriptions list.
