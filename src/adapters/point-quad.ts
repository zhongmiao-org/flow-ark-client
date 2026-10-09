const invalidGeometry = () => new Error('网页框架几何无法确认，请重新选取');

/** Invert the projection from a unit rectangle to Chromium's content quad. */
export function unprojectQuad(quad: number[], x: number, y: number) {
  if (quad.length !== 8 || ![...quad, x, y].every(Number.isFinite)) throw invalidGeometry();
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4,
      k = (i + 2) % 4;
    const cross =
      (quad[2 * j] - quad[2 * i]) * (quad[2 * k + 1] - quad[2 * j + 1]) -
      (quad[2 * j + 1] - quad[2 * i + 1]) * (quad[2 * k] - quad[2 * j]);
    if (Math.abs(cross) < 1e-8 || (sign && Math.sign(cross) !== sign)) throw invalidGeometry();
    sign = Math.sign(cross);
  }
  const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    rows: number[][] = [];
  corners.forEach(([u, v], i) => {
    const px = quad[2 * i],
      py = quad[2 * i + 1];
    rows.push([u, v, 1, 0, 0, 0, -u * px, -v * px, px], [0, 0, 0, u, v, 1, -u * py, -v * py, py]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-10) throw invalidGeometry();
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    for (let j = col; j <= 8; j++) rows[col][j] /= scale;
    for (let row = 0; row < 8; row++)
      if (row !== col) {
        const factor = rows[row][col];
        for (let j = col; j <= 8; j++) rows[row][j] -= factor * rows[col][j];
      }
  }
  const h = rows.map((r) => r[8]);
  const a = h[0] - x * h[6],
    b = h[1] - x * h[7],
    c = x - h[2],
    d = h[3] - y * h[6],
    e = h[4] - y * h[7],
    f = y - h[5],
    det = a * e - b * d;
  if (Math.abs(det) < 1e-10) throw invalidGeometry();
  const u = (c * e - b * f) / det,
    v = (a * f - c * d) / det;
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw invalidGeometry();
  return u < 0 || v < 0 || u > 1 || v > 1 ? undefined : { u, v };
}
