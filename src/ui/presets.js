// Contemplative motion presets. Each preset maps the current dimension to a
// set of plane angular velocities (rad/s); selecting one replaces the active
// velocities, and manual plane toggles simply diverge from it afterwards.

export const PRESETS = [
  {
    name: "stillness",
    note: "a single slow turn through the highest axis",
    velocities(n) {
      return [{ plane: [0, n - 1], omega: 0.15 }];
    },
  },
  {
    name: "isocline",
    note: "two equal rotations — every vertex rides a great circle",
    velocities(n) {
      if (n < 4) return [{ plane: [0, 1], omega: 0.22 }];
      return [
        { plane: [0, 1], omega: 0.22 },
        { plane: [n - 2, n - 1], omega: 0.22 },
      ];
    },
  },
  {
    name: "tumble",
    note: "three incommensurate speeds — the pose never repeats",
    velocities(n) {
      const v = [{ plane: [0, 1], omega: 0.21 }];
      if (n >= 3) v.push({ plane: [1, n - 1], omega: 0.134 });
      if (n >= 4) v.push({ plane: [0, 2], omega: 0.083 });
      return v;
    },
  },
  {
    name: "within",
    note: "cells exchanging places, seen from just outside one of them",
    projection: "schlegel",
    velocities(n) {
      return [{ plane: [n - 2, n - 1], omega: 0.18 }];
    },
  },
];

export function presetByName(name) {
  return PRESETS.find((p) => p.name === name) ?? null;
}
