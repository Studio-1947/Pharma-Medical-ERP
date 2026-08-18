"use client";

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Page controls for a server-paginated list.
 *
 * Every list endpoint here paginates and returns this meta, but several screens
 * fetched without a page and rendered whatever came back — so procurement
 * showed the first 20 purchase orders and the first 100 suppliers with nothing
 * on screen admitting there were more. The row count is part of the control for
 * that reason: "20 of 20" and "20 of 253" look identical without it.
 *
 * Renders nothing for a single page, so a short list stays uncluttered.
 */
export function Pagination({
  meta,
  onPageChange,
  noun = "records",
}: {
  meta: PageMeta | undefined;
  onPageChange: (page: number) => void;
  /** What is being counted, for the summary line. */
  noun?: string;
}) {
  if (!meta || meta.totalPages <= 1) return null;

  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
      <span>
        Showing {from}&ndash;{to} of {meta.total} {noun} &bull; page {meta.page} of{" "}
        {meta.totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
          className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
          className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Pulls the pagination meta out of the several response shapes in use here. */
export function readPageMeta(raw: unknown): PageMeta | undefined {
  const d = raw as any;
  const meta = d?.meta ?? d?.data?.meta;
  if (!meta || typeof meta.totalPages !== "number") return undefined;
  return meta as PageMeta;
}
