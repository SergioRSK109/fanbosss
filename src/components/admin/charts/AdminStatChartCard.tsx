"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "@/lib/adminStats";

// Single-series daily trend card for /admin's "Vue d'ensemble" -- one
// hue per metric, per the dataviz skill's own form-selection rule
// ("trend over time -> line; color job: sequential or 1 categorical").
// Each of the 4 metrics this feature adds (inscriptions, GMV, revenu,
// publications) lives in its OWN separate card/chart, never overlaid
// with another series on the same axis -- so there's no legend to build
// (a single series needs no legend box, the title already says what's
// plotted) and no categorical-palette CVD check to run (that only
// applies when two-or-more hues must be told apart on ONE plot).
//
// `unit` is a plain string discriminator, not a formatter function --
// this component is "use client" and its caller (admin/page.tsx) is a
// Server Component, so a closure can't cross that boundary as a prop
// (only plain serializable data can); the formatting logic lives here
// instead, driven by this one string.
export function AdminStatChartCard({
  title,
  data,
  color,
  unit,
}: {
  title: string;
  data: DailyPoint[];
  color: string;
  unit: "currency" | "count";
}) {
  const t = useTranslations("Admin.charts");
  const locale = useLocale();

  const formatValue = (value: number) =>
    unit === "currency" ? `${value.toFixed(0)}$` : `${value}`;

  const dateFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", {
    day: "numeric",
    month: "short",
  });
  const formatTick = (isoDate: string) => dateFormatter.format(new Date(`${isoDate}T12:00:00Z`));

  const latest = data.length > 0 ? data[data.length - 1].value : 0;

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground-muted">{title}</h3>
        <div className="text-right">
          <div className="text-xl font-bold">{formatValue(latest)}</div>
          <div className="text-xs text-foreground-muted">{t("today")}</div>
        </div>
      </div>
      <div className="mt-3 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid
              stroke="var(--color-border)"
              vertical={false}
              strokeDasharray="0"
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatTick}
              tick={{ fontSize: 11, fill: "var(--color-foreground-muted)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              width={40}
              tick={{ fontSize: 11, fill: "var(--color-foreground-muted)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => formatValue(value)}
              allowDecimals={false}
            />
            <Tooltip
              labelFormatter={(label) => (typeof label === "string" ? formatTick(label) : "")}
              formatter={(value) => [formatValue(Number(value)), title]}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--color-foreground)",
              }}
              labelStyle={{ color: "var(--color-foreground-muted)" }}
              cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{
                r: 4,
                fill: color,
                stroke: "var(--color-surface)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
