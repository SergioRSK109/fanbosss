"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { OffreTypeBreakdownEntry } from "@/lib/adminStats";
import type { OffreType } from "@/lib/validation";

// "Répartition par type d'offre" -- montant per type, over the same
// 30-day window as the rest of this page's daily charts. Per the
// dataviz skill's own form table, this is a magnitude comparison
// ("compare magnitude, low -> high"), not an identity/distinct-series
// question -- so it's a single sequential hue (brand-500), never one
// color per bar: coloring each bar a different categorical hue here
// would double-encode the same "which type" information the Y-axis
// labels already carry, for no benefit, and would need a legend + a
// colorblind-safety check that a plain magnitude bar never requires.
// Horizontal (not vertical columns) because offer-type labels
// ("Contenu exclusif", "Accès live privé"...) are long -- per the
// skill's own "part-to-whole... go horizontal for many/long-named
// categories" guidance, generalized here to "long-named categories" in
// general.
export function AdminOffreTypeBarChart({
  data,
  color,
}: {
  data: OffreTypeBreakdownEntry[];
  color: string;
}) {
  const t = useTranslations("Admin.charts");
  const tOffers = useTranslations("CreateurProfile.offerTypes");

  if (data.length === 0) {
    return <p className="text-sm text-foreground-muted">{t("breakdownEmpty")}</p>;
  }

  const chartData = data.map((entry) => ({
    type: entry.type,
    montant: entry.montant,
    label: tOffers(entry.type as OffreType),
  }));

  // ~40px per row (label + bar + breathing room) plus a little chrome,
  // so a shorter list of active types doesn't leave a tall, mostly-empty
  // card, and a full 8-type list still gets room for every label.
  const height = chartData.length * 40 + 16;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 36, left: 4, bottom: 4 }}
          barCategoryGap={10}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Bar dataKey="montant" barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {chartData.map((entry) => (
              <Cell key={entry.type} fill={color} />
            ))}
            <LabelList
              dataKey="montant"
              position="right"
              formatter={(value) => `${Number(value ?? 0).toFixed(0)}$`}
              style={{ fill: "var(--color-foreground)", fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
