/** Small DOM canvas helpers shared by the image modules (browser only; nothing runs at import time). */

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") throw new Error("Image processing is only available in the browser.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** 2D context or a readable error (contexts can be refused when the device is out of memory). */
export function get2d(canvas: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("This browser couldn't create a drawing surface. Close other tabs and try again.");
  return ctx;
}
