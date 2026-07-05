interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'teal' | 'amber' | 'red' | 'blue';
}

export function StatCard({ label, value, tone = 'teal' }: StatCardProps) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
