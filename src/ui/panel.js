// The structure panel: the n-cube counted. A small sigma glyph expands a
// translucent table of element counts with the general formula, plus the
// Gray-code toggle. One line of context per item, nothing more.

import { elementCounts, symmetryOrder } from "../core/combinatorics.js";
import { sectionFigure } from "../core/section.js";

const ELEMENT_NAMES = [
  "vertices",
  "edges",
  "faces",
  "cells",
  "4-cells",
  "5-cells",
];

export function initPanel({ toggle, panel, state, actions }) {
  toggle.addEventListener("click", () => {
    const open = panel.hasAttribute("hidden");
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const table = document.createElement("table");
  const formula = document.createElement("p");
  formula.className = "formula";
  formula.innerHTML =
    "k-elements of the n-cube: <i>C(n,k)&thinsp;·&thinsp;2<sup>n−k</sup></i><br />" +
    "symmetries: <i>2<sup>n</sup>&thinsp;·&thinsp;n!</i> — mirrors and quarter-turns";

  const grayLabel = document.createElement("label");
  grayLabel.className = "gray-toggle";
  const grayBox = document.createElement("input");
  grayBox.type = "checkbox";
  grayBox.addEventListener("change", () => actions.toggleGray());
  grayLabel.append(
    grayBox,
    document.createTextNode(" Gray code — one light visits every vertex"),
  );

  const caption = document.createElement("p");
  caption.className = "section-caption";
  panel.append(caption, table, formula, grayLabel);

  let builtFor = "";

  function update() {
    grayBox.checked = state.gray;
    const sectionView = state.view === "section";
    grayBox.disabled = sectionView;
    grayLabel.classList.toggle("is-disabled", sectionView);
    if (sectionView) {
      // The rows are the cut. The formula under the table stays the n-cube's,
      // as context — repeating it here would claim the slice had those counts.
      const g = state.geometry;
      const h = Number.isFinite(state.cut) ? state.cut : 0;
      const faces = g.faces ? g.faces.length : 0;
      const cells = g.cells ? g.cells.length : 0;
      // The name is empty almost everywhere on a sweep. It belongs in the
      // key: within one displayed thousandth the edges can stop being equal.
      const figure = sectionFigure(g);
      const key = `s:${state.n}:${g.vertices.length}:${g.edges.length}:${faces}:${cells}:${figure}:${h.toFixed(3)}`;
      caption.textContent = "section Σ xᵢ = h";
      if (builtFor === key) return;
      builtFor = key;
      table.textContent = "";
      const rows = [
        ["vertices", String(g.vertices.length)],
        ["edges", String(g.edges.length)],
        ["faces", String(faces)],
      ];
      if (state.n >= 4) rows.push(["cells", String(cells)]);
      rows.push(["Σ xᵢ", h.toFixed(3)]);
      if (figure) rows.push(["figure", figure]);
      for (const [name, value] of rows) {
        const row = table.insertRow();
        row.insertCell().textContent = name;
        row.insertCell().textContent = value;
      }
      return;
    }
    caption.textContent = "";
    const key = `n:${state.n}`;
    if (builtFor === key) return;
    builtFor = key;
    const counts = elementCounts(state.n);
    table.textContent = "";
    for (let k = 0; k < state.n; k++) {
      const row = table.insertRow();
      row.insertCell().textContent = ELEMENT_NAMES[k];
      row.insertCell().textContent = String(counts[k]);
    }
    const symmetries = table.insertRow();
    symmetries.className = "symmetries";
    symmetries.title =
      "the hyperoctahedral group B_n: 2^n sign flips × n! axis permutations";
    symmetries.insertCell().textContent = "symmetries";
    symmetries.insertCell().textContent = String(symmetryOrder(state.n));
  }

  return { update };
}
