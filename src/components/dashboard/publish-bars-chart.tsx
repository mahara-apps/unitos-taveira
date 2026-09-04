import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Publicações por dia — colunas temporais.
 *
 * Substitui o antigo gráfico de área: colunas são mais legíveis para contagem
 * diária discreta. Sem legenda interna (a legenda fica ABAIXO do gráfico, no
 * card) e com rótulos de data espaçados para nunca sobrepor.
 */
export default function PublishBarsChart({
  data,
}: {
  data: Array<{ day: string; label: string; posts: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          stroke="var(--muted-foreground)"
          interval="preserveStartEnd"
          minTickGap={28}
          height={18}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          stroke="var(--muted-foreground)"
          allowDecimals={false}
          width={28}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.35 }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            fontSize: 12,
          }}
          labelFormatter={(v) => String(v)}
          formatter={(value: number) => [
            `${value} ${value === 1 ? "publicação" : "publicações"}`,
            "Publicações",
          ]}
        />
        <Bar dataKey="posts" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
