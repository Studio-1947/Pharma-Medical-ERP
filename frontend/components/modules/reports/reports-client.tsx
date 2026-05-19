"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Download, FileText, Calendar, Filter } from "lucide-react";

export function ReportsClient() {
  const [gstBranchId, setGstBranchId] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const [schBranchId, setSchBranchId] = useState("");
  const [fromDate, setFromDate] = useState(new Date().toISOString().split("T")[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split("T")[0]);

  // Download GSTR-1 CSV
  const downloadGstCsv = async () => {
    try {
      const response = await apiClient.get("/reports/gst", {
        params: { branchId: gstBranchId || undefined, month, year, format: "csv" },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `gstr1-${year}-${month}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to download GSTR-1 CSV");
    }
  };

  // Download Schedule H CSV
  const downloadScheduleHCsv = async () => {
    try {
      const response = await apiClient.get("/reports/schedule-h-register", {
        params: { branchId: schBranchId || undefined, from: fromDate, to: toDate, format: "csv" },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `schedule-h-${fromDate}-to-${toDate}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to download Schedule H CSV");
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Reports & Compliance</h1>
        <p className="text-muted-foreground mt-1">Export legal and GST compliance registers as CSV.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* GSTR-1 CSV Card */}
        <div className="bg-card hover:shadow-md transition-shadow duration-300 rounded-xl border p-6 flex flex-col justify-between h-full bg-white backdrop-blur-sm bg-opacity-70">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">GSTR-1 Report</h2>
                <p className="text-sm text-muted-foreground">Exports detailed sales tax breakdowns.</p>
              </div>
            </div>

            <hr />

            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">Branch ID (Optional)</label>
                <input
                  type="text"
                  placeholder="All Branches if empty"
                  value={gstBranchId}
                  onChange={(e) => setGstBranchId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700">Month</label>
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {new Date(0, i).toLocaleString("en", { month: "long" })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700">Year</label>
                  <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {Array.from({ length: 5 }, (_, i) => (
                      <option key={i} value={new Date().getFullYear() - 2 + i}>
                        {new Date().getFullYear() - 2 + i}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button
              onClick={downloadGstCsv}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition duration-200 shadow-sm"
            >
              <Download className="w-4 h-4" /> Download GSTR-1 CSV
            </button>
          </div>
        </div>

        {/* Schedule H Register Card */}
        <div className="bg-card hover:shadow-md transition-shadow duration-300 rounded-xl border p-6 flex flex-col justify-between h-full bg-white backdrop-blur-sm bg-opacity-70">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Schedule H Register</h2>
                <p className="text-sm text-muted-foreground">Exports controlled drugs dispensing details.</p>
              </div>
            </div>

            <hr />

            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">Branch ID (Optional)</label>
                <input
                  type="text"
                  placeholder="All Branches if empty"
                  value={schBranchId}
                  onChange={(e) => setSchBranchId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700">From Date</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700">To Date</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button
              onClick={downloadScheduleHCsv}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition duration-200 shadow-sm"
            >
              <Download className="w-4 h-4" /> Download Register CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
