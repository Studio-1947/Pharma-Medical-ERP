"use client";

import React from "react";
import { clsx } from "clsx";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export type StatColor = "emerald" | "teal" | "cyan" | "purple" | "amber" | "rose" | "slate";

export interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string | number;
    direction: "up" | "down" | "neutral";
    label?: string;
  };
  color?: StatColor;
  className?: string;
}

const colorMap: Record<StatColor, { bg: string; text: string; ring: string }> = {
  emerald: {
    bg: "bg-emerald-50 dark:bg-emerald-950/50",
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-500/20",
  },
  teal: {
    bg: "bg-teal-50 dark:bg-teal-950/50",
    text: "text-teal-600 dark:text-teal-400",
    ring: "ring-teal-500/20",
  },
  cyan: {
    bg: "bg-cyan-50 dark:bg-cyan-950/50",
    text: "text-cyan-600 dark:text-cyan-400",
    ring: "ring-cyan-500/20",
  },
  purple: {
    bg: "bg-purple-50 dark:bg-purple-950/50",
    text: "text-purple-600 dark:text-purple-400",
    ring: "ring-purple-500/20",
  },
  amber: {
    bg: "bg-amber-50 dark:bg-amber-950/50",
    text: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/20",
  },
  rose: {
    bg: "bg-rose-50 dark:bg-rose-950/50",
    text: "text-rose-600 dark:text-rose-400",
    ring: "ring-rose-500/20",
  },
  slate: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-600 dark:text-slate-300",
    ring: "ring-slate-500/20",
  },
};

export function StatCard({
  title,
  value,
  description,
  icon,
  trend,
  color = "emerald",
  className,
}: StatCardProps) {
  const colorStyle = colorMap[color];

  return (
    <div
      className={clsx(
        "relative p-5 rounded-2xl bg-white border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all duration-200 flex flex-col justify-between overflow-hidden group",
        className
      )}
    >
      {/* Decorative subtle top border line with accent color */}
      <div
        className={clsx(
          "absolute top-0 left-0 right-0 h-1 transition-opacity opacity-75 group-hover:opacity-100",
          color === "emerald" && "bg-gradient-to-r from-emerald-500 to-teal-500",
          color === "teal" && "bg-gradient-to-r from-teal-500 to-cyan-500",
          color === "cyan" && "bg-gradient-to-r from-cyan-500 to-sky-500",
          color === "purple" && "bg-gradient-to-r from-purple-500 to-indigo-500",
          color === "amber" && "bg-gradient-to-r from-amber-500 to-orange-500",
          color === "rose" && "bg-gradient-to-r from-rose-500 to-red-500",
          color === "slate" && "bg-slate-400"
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider truncate">
            {title}
          </p>
          <h3 className="text-2xl font-bold text-slate-900 mt-1 tracking-tight truncate">
            {value}
          </h3>
        </div>
        {icon && (
          <div
            className={clsx(
              "w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 duration-200",
              colorStyle.bg,
              colorStyle.text
            )}
          >
            {icon}
          </div>
        )}
      </div>

      {(description || trend) && (
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          {trend && (
            <span
              className={clsx(
                "inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-md",
                trend.direction === "up" && "bg-emerald-50 text-emerald-700",
                trend.direction === "down" && "bg-rose-50 text-rose-700",
                trend.direction === "neutral" && "bg-slate-100 text-slate-600"
              )}
            >
              {trend.direction === "up" && <TrendingUp className="w-3.5 h-3.5" />}
              {trend.direction === "down" && <TrendingDown className="w-3.5 h-3.5" />}
              {trend.direction === "neutral" && <Minus className="w-3.5 h-3.5" />}
              {trend.value}
            </span>
          )}
          {description && (
            <span className="text-slate-400 font-medium truncate ml-auto">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
