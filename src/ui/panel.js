// The structure panel: the n-cube counted. A small sigma glyph expands a
// translucent table of element counts with the general formula, plus the
// Gray-code toggle. One line of context per item, nothing more.

import { elementCounts, symmetryOrder } from "../core/combinatorics.js";

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

  panel.append(table, formula, grayLabel);

  let builtForN = 0;

  function update() {
    grayBox.checked = state.gray;
    if (builtForN === state.n) return;
    builtForN = state.n;
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
