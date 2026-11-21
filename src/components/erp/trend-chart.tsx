"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";

export type TrendSeries = { key: string; name: string; color: string };

function axisMoney(v: number) {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000) / 10}万`;
  return String(v);
}

export function TrendChart({
  data,
  series,
  height = 260,
}: {
  data: ({ label: string } & Record<string, number | string>)[];
  series: TrendSeries[];
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
          <CartesianGrid stroke="#e9e9e7" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#787774" />
          <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="#a5a29c" width={52} tickFormatter={axisMoney} />
          <Tooltip
            cursor={{ fill: "#f1f1ef" }}
            formatter={(v) => formatMoney(Number(v))}
            contentStyle={{ borderRadius: 6, border: "1px solid #e9e9e7", fontSize: 12, boxShadow: "0 3px 6px rgba(15,15,15,.08)" }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={26} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
