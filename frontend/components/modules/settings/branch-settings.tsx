"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, MapPin, Phone, Mail, FileText } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface Branch {
  id: string;
  name: string;
  code: string;
  gstin?: string;
  drugLicenseNo?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
}

export function BranchSettings() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["branches"],
    queryFn: () => apiClient.get("/branches"),
    retry: 1,
  });

  const branches: Branch[] = data?.data ?? data ?? [];

  if (isLoading) {
    return <div className="text-center py-16 text-muted-foreground">Loading branches...</div>;
  }

  return (
    <div className="space-y-4">
      {branches.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">No branches configured.</div>
      )}
      {branches.map((branch) => (
        <div
          key={branch.id}
          className="rounded-xl border bg-white p-5 space-y-3"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <Building2 size={18} />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">{branch.name}</h3>
                <p className="text-xs text-muted-foreground font-mono">{branch.code}</p>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                branch.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}
            >
              {branch.isActive ? "Active" : "Inactive"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {branch.addressLine1 && (
              <div className="flex items-start gap-2 text-slate-600">
                <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {branch.addressLine1}
                  {branch.city ? `, ${branch.city}` : ""}
                  {branch.state ? `, ${branch.state}` : ""}
                </span>
              </div>
            )}
            {branch.phone && (
              <div className="flex items-center gap-2 text-slate-600">
                <Phone size={14} className="shrink-0 text-slate-400" />
                <span>{branch.phone}</span>
              </div>
            )}
            {branch.email && (
              <div className="flex items-center gap-2 text-slate-600">
                <Mail size={14} className="shrink-0 text-slate-400" />
                <span>{branch.email}</span>
              </div>
            )}
            {branch.gstin && (
              <div className="flex items-center gap-2 text-slate-600">
                <FileText size={14} className="shrink-0 text-slate-400" />
                <span>GSTIN: <span className="font-mono">{branch.gstin}</span></span>
              </div>
            )}
            {branch.drugLicenseNo && (
              <div className="flex items-center gap-2 text-slate-600">
                <FileText size={14} className="shrink-0 text-slate-400" />
                <span>Drug License: <span className="font-mono">{branch.drugLicenseNo}</span></span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
