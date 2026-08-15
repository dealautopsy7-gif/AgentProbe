export function Logo({ size = 18, label = true }: { size?: number; label?: boolean }) {
  const dot = Math.max(4, Math.round(size * 0.28));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div
        style={{
          width: size,
          height: size,
          border: "1px solid var(--cyan)",
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div style={{ width: dot, height: dot, background: "var(--cyan)", borderRadius: 1 }} />
      </div>
      {label && <span style={{ font: "600 15px/1 Inter, sans-serif" }}>AgentProbe</span>}
    </div>
  );
}
