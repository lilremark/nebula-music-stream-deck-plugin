export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function volumeFromTouch(x: number, canvasWidth = 200): number {
  return clamp(x / canvasWidth, 0, 1);
}

export function steppedVolume(current: number, ticks: number, stepPercent = 2): number {
  return clamp(current + (ticks * stepPercent) / 100, 0, 1);
}

export function seekSeconds(ticks: number, stepSeconds = 5): number {
  return clamp(ticks * stepSeconds, -86_400, 86_400);
}
