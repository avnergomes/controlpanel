// Minimal canvas sparkline (line + soft fill), DPR aware.

function toRgba(color, alpha) {
  const c = String(color || "").trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m = c.match(/\d+(\.\d+)?/g);
  if (m && m.length >= 3) return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
  return `rgba(0, 245, 212, ${alpha})`;
}

export function drawSparkline(canvas, data, color = "#00f5d4") {
  if (!canvas || !data || data.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const pad = 2;
  const max = Math.max(...data, 1);
  const stepX = (width - pad * 2) / (data.length - 1);
  const yOf = (v) => height - pad - (v / max) * (height - pad * 2);

  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = yOf(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.lineTo(pad + (data.length - 1) * stepX, height - pad);
  ctx.lineTo(pad, height - pad);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, toRgba(color, 0.28));
  gradient.addColorStop(1, toRgba(color, 0.02));
  ctx.fillStyle = gradient;
  ctx.fill();

  // Last point marker.
  const lx = pad + (data.length - 1) * stepX;
  ctx.beginPath();
  ctx.arc(lx, yOf(data[data.length - 1]), 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
