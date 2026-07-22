// Renders a weekly recap to a 1080x1920 Instagram-story image on a canvas, so
// it can be shared straight to a story. No external libraries: everything is
// drawn with the 2D context. Colours mirror the candy theme.

import type { WeeklyRecap } from "@/lib/recap.functions";

const W = 1080;
const H = 1920;

type Stat = { label: string; value: number; emoji: string };

function statsFrom(recap: WeeklyRecap): Stat[] {
  return [
    { label: "matches", value: recap.newMatches, emoji: "💌" },
    { label: "picked you", value: recap.admirers, emoji: "👀" },
    { label: "poll votes", value: recap.pollWins, emoji: "🏆" },
    { label: "day streak", value: recap.streak, emoji: "🔥" },
    { label: "invites", value: recap.invites, emoji: "🎉" },
  ].filter((s) => s.value > 0);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Wrap `text` to `maxWidth`, returning the lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderRecapStory(recap: WeeklyRecap): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  // Inter matches the app; fall back to a heavy system stack if it hasn't
  // loaded. Waiting on document.fonts keeps the render crisp.
  const font = (weight: number, size: number) =>
    `${weight} ${size}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts optional */
  }

  // Base vertical wash: cream -> soft pink.
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, "#fdf6e3");
  base.addColorStop(1, "#fbe4ee");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Atmospheric radial blooms (yellow, pink, lavender) — the candy signature.
  const bloom = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  bloom(W * 0.9, H * 0.05, 760, "rgba(250, 224, 120, 0.75)");
  bloom(W * 0.05, H * 0.18, 720, "rgba(245, 160, 175, 0.6)");
  bloom(W * 0.5, H * 1.02, 900, "rgba(205, 170, 235, 0.7)");

  // Wordmark.
  ctx.textAlign = "center";
  ctx.fillStyle = "#1a1424";
  ctx.font = font(900, 64);
  ctx.fillText("crush", W / 2, 260);
  ctx.font = font(700, 30);
  ctx.fillStyle = "rgba(26,20,36,0.55)";
  ctx.fillText("only if it's mutual", W / 2, 312);

  // Eyebrow.
  ctx.font = font(800, 30);
  ctx.fillStyle = "rgba(26,20,36,0.5)";
  ctx.fillText("YOUR WEEK", W / 2, 560);

  // Headline (may wrap to 2-3 lines).
  ctx.fillStyle = "#1a1424";
  ctx.font = font(900, 86);
  // Strip the trailing emoji off the headline for cleaner wrapping; re-add it
  // on the last line if present.
  const lines = wrap(ctx, recap.headline, W - 200);
  let y = 700;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += 104;
  }

  // Stat pills, centered, wrapping across rows.
  const stats = statsFrom(recap);
  ctx.font = font(800, 40);
  const padX = 44;
  const gap = 28;
  const pillH = 96;
  const measured = stats.map((s) => {
    const text = `${s.emoji}  ${s.value} ${s.label}`;
    return { text, w: ctx.measureText(text).width + padX * 2 };
  });

  // Lay out into rows that fit the width.
  const maxRowW = W - 160;
  const rows: { text: string; w: number }[][] = [[]];
  let rowW = 0;
  for (const m of measured) {
    if (rowW + m.w + gap > maxRowW && rows[rows.length - 1].length) {
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1].push(m);
    rowW += m.w + gap;
  }

  let pillY = y + 40;
  for (const row of rows) {
    const totalW = row.reduce((a, m) => a + m.w, 0) + gap * (row.length - 1);
    let x = (W - totalW) / 2;
    for (const m of row) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      roundRect(ctx, x, pillY, m.w, pillH, pillH / 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(26,20,36,0.08)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#1a1424";
      ctx.textAlign = "center";
      ctx.fillText(m.text, x + m.w / 2, pillY + pillH / 2 + 14);
      x += m.w + gap;
    }
    pillY += pillH + gap;
  }

  // Footer CTA.
  ctx.textAlign = "center";
  ctx.font = font(800, 38);
  ctx.fillStyle = "#1a1424";
  ctx.fillText("pick your secret crush", W / 2, H - 200);
  ctx.font = font(700, 32);
  ctx.fillStyle = "rgba(26,20,36,0.55)";
  ctx.fillText("crush-connect.ludomi2502.workers.dev", W / 2, H - 150);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/**
 * Share the recap image via the Web Share API when it supports files, else
 * fall back to a download. Returns how it was handled so the UI can respond.
 */
export async function shareRecapStory(recap: WeeklyRecap): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await renderRecapStory(recap);
  const file = new File([blob], "crush-week.png", { type: "image/png" });

  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "my week on crush" });
      return "shared";
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return "cancelled";
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "crush-week.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
