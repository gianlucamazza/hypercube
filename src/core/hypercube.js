// Construction of the n-cube from bit strings.
//
// Vertex index i IS its coordinate signature: bit b of i gives coordinate b
// as -0.5 (bit unset) or +0.5 (bit set). Edge length is 1, circumradius
// sqrt(n)/2. Edges, Gray code paths and cell membership all reduce to bit
// arithmetic on vertex indices.

export function hypercube(n) {
  const count = 2 ** n;

  const vertices = [];
  for (let i = 0; i < count; i++) {
    const v = [];
    for (let b = 0; b < n; b++) v.push(i & (1 << b) ? 0.5 : -0.5);
    vertices.push(v);
  }

  // Edges connect vertices at Hamming distance 1: for each vertex with bit b
  // unset, flipping b gives the neighbour with a larger index.
  const edges = [];
  for (let i = 0; i < count; i++)
    for (let b = 0; b < n; b++)
      if (!(i & (1 << b))) edges.push([i, i | (1 << b)]);

  // Faces: choose 2 free bits (a < b), fix the remaining n-2 bits.
  // Vertices listed in cyclic order: 00, 10, 11, 01 on the free bits.
  const faces = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const bitA = 1 << a;
      const bitB = 1 << b;
      for (let base = 0; base < count; base++) {
        if (base & (bitA | bitB)) continue;
        faces.push([base, base | bitA, base | bitA | bitB, base | bitB]);
      }
    }
  }

  return { n, vertices, edges, faces };
}

// Vertex indices of the cell (facet) where coordinate `axis` is fixed to
// sign +1 or -1. For n=4, cell(axis=3, +1) is the w=+0.5 cube.
export function cellVertices(n, axis, sign) {
  const bit = 1 << axis;
  const indices = [];
  for (let i = 0; i < 2 ** n; i++) {
    if ((i & bit ? 1 : -1) === sign) indices.push(i);
  }
  return indices;
}
