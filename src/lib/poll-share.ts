// Renders an Instagram-Story-sized share card to a PNG blob and triggers
// download / native share. Runs only in the browser.

export type ShareCardInput = {
  question: string;
  superlative: string; // e.g. "Most likely to start a cult"
  voterCount: number;
};

const W = 1080;
const H = 1920;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#FFD93D");
  bg.addColorStop(0.5, "#FF6F91");
  bg.addColorStop(1, "#9B5DE5");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Decorative blobs
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#FFE9F4";
  ctx.beginPath(); ctx.arc(160, 220, 280, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#C8FFE0";
  ctx.beginPath(); ctx.arc(W - 140, H - 320, 260, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Centered card
  const cardX = 90, cardY = 360, cardW = W - 180, cardH = 1200;
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = "#0F0F14";
  ctx.lineWidth = 8;
  roundRect(ctx, cardX, cardY, cardW, cardH, 64);
  ctx.fill();
  ctx.stroke();

  // Crush wordmark
  ctx.fillStyle = "#0F0F14";
  ctx.font = "900 64px ui-sans-serif, system-ui, -apple-system, Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("crush", W / 2, 220);
  ctx.font = "700 30px ui-sans-serif, system-ui, -apple-system, Inter, sans-serif";
  ctx.fillStyle = "#0F0F14CC";
  ctx.fillText("anonymous superlatives", W / 2, 270);

  // "I was voted"
  ctx.fillStyle = "#0F0F14AA";
  ctx.font = "700 44px ui-sans-serif, system-ui, -apple-system, Inter, sans-serif";
  ctx.fillText("I was voted", W / 2, cardY + 140);

  // Big superlative
  ctx.fillStyle = "#0F0F14";
  ctx.font = "900 92px ui-sans-serif, system-ui, -apple-system, Inter, sans-serif";
  const titleLines = wrap(ctx, `"${input.superlative}"`, cardW - 120);
  let y = cardY + 280;
  for (const line of titleLines.slice(0, 4)) {
    ctx.fillText(line, W / 2, y);
    y += 110;
  }

  // by N people pill
  const pillText = `by ${input.voterCount} ${input.voterCount === 1 ? "person" : "people"} recently ✨`;
  ctx.font = "800 44px ui-sans-serif, system-ui, -apple-system, Inter, sans-serif";
  const pillW = Math.min(cardW - 140, ctx.measureText(pillText).width + 80);
  const pillH = 100;
  const pillX = W / 2 - pillW / 2;
  const pillY = cardY + cardH - 260;
  ctx.fillStyle = "#FFD93D";
  ctx.strokeStyle = "#0F0F14";
  ctx.lineWidth = 6;
  roundRect(ctx, pillX, pillY, pillW, pillH, 50);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0F0F14";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, W / 2, pillY + pillH / 2 + 4);
  ctx.textBaseline = "alphabetic";

  // Footer URL — honest copy: results are anonymous.
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 42px ui-sans-serif, system-ui, -apple-system, Inter, sans-serif";
  ctx.fillText("anonymous polls on crush", W / 2, H - 130);

  return await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), "image/png", 0.95);
  });
}

export type ShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

export async function sharePollCard(input: ShareCardInput): Promise<ShareOutcome> {
  const blob = await renderShareCard(input);
  const file = new File([blob], "crush-poll.png", { type: "image/png" });
  const text = `I was voted "${input.superlative}" on crush 😭`;

  // Native share (with file) preferred
  try {
    if (typeof navigator !== "undefined" && "canShare" in navigator && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "crush", text });
      return "shared";
    }
  } catch (err) {
    // User cancelled a share dialog — do not fall back to download.
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    // Other failures fall through to download.
  }

  // Fallback: trigger download
  try {
    const dl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dl;
    a.download = "crush-poll.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(dl);
    return "downloaded";
  } catch {
    return "failed";
  }
}
