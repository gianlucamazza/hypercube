// Canvas 2D surface: devicePixelRatio-aware sizing and per-frame setup.
// Drawing happens in CSS pixels with the origin at the canvas centre.

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
  }

  new ResizeObserver(resize).observe(canvas);
  resize();

  function begin() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);
    ctx.lineCap = "round";
  }

  return {
    ctx,
    begin,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
  };
}
