// Migration runs in both the browser and the local server. Keep its memory bound
// independent of the length of legacy labels; most edits need only a small diff.
const MAX_MATRIX_CELLS = 4_100_000;
const MAX_EDIT_DISTANCE = 256;

function matrixAdditions(original, edited) {
  const columns = edited.length + 1;
  const scores = new Uint32Array((original.length + 1) * columns);
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = edited.length - 1; j >= 0; j--) {
      scores[i * columns + j] = original[i] === edited[j]
        ? scores[(i + 1) * columns + j + 1] + 1
        : Math.max(scores[(i + 1) * columns + j], scores[i * columns + j + 1]);
    }
  }
  const additions = [];
  let i = 0, j = 0;
  while (i < original.length && j < edited.length) {
    if (original[i] === edited[j]) { i++; j++; }
    else if (scores[(i + 1) * columns + j] >= scores[i * columns + j + 1]) i++;
    else additions.push(edited[j++]);
  }
  return additions.concat(edited.slice(j)).join('');
}

// A bounded Myers search handles very long labels with a few scattered edits
// without allocating a length-by-length matrix.
function nearbyAdditions(original, edited) {
  if (Math.abs(original.length - edited.length) > MAX_EDIT_DISTANCE) return undefined;
  const offset = MAX_EDIT_DISTANCE + 1;
  const frontier = new Int32Array(offset * 2 + 1).fill(-1);
  frontier[offset + 1] = 0;
  const trace = [];
  for (let distance = 0; distance <= MAX_EDIT_DISTANCE; distance++) {
    trace.push(frontier.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const slot = offset + diagonal;
      let x = diagonal === -distance || (diagonal !== distance && frontier[slot - 1] < frontier[slot + 1])
        ? frontier[slot + 1] : frontier[slot - 1] + 1;
      let y = x - diagonal;
      while (x < original.length && y < edited.length && original[x] === edited[y]) { x++; y++; }
      frontier[slot] = x;
      if (x < original.length || y < edited.length) continue;
      const additions = [];
      for (let step = distance; step >= 0; step--) {
        const previous = trace[step];
        const currentDiagonal = x - y;
        const currentSlot = offset + currentDiagonal;
        const beforeDiagonal = currentDiagonal === -step
          || (currentDiagonal !== step && previous[currentSlot - 1] < previous[currentSlot + 1])
          ? currentDiagonal + 1 : currentDiagonal - 1;
        const beforeX = previous[offset + beforeDiagonal];
        const beforeY = beforeX - beforeDiagonal;
        while (x > beforeX && y > beforeY) { x--; y--; }
        if (!step) break;
        if (x === beforeX) additions.push(edited[--y]);
        else x--;
      }
      return additions.reverse().join('');
    }
  }
  return undefined;
}

// Pathological, heavily rewritten long imports use a deterministic monotonic
// match. This bounds the fallback to linear storage and O(n + m log n) work.
function longAdditions(original, edited) {
  const positions = new Map();
  original.forEach((character, index) => {
    const indices = positions.get(character);
    if (indices) indices.push(index);
    else positions.set(character, [index]);
  });
  let after = 0;
  const additions = [];
  for (const character of edited) {
    const indices = positions.get(character) ?? [];
    let low = 0, high = indices.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (indices[middle] < after) low = middle + 1;
      else high = middle;
    }
    if (low < indices.length) after = indices[low] + 1;
    else additions.push(character);
  }
  return additions.join('');
}

function addedText(original, edited) {
  if (original === edited || !edited) return '';
  if (!original) return edited;
  const before = Array.from(original);
  const after = Array.from(edited);
  let start = 0, beforeEnd = before.length, afterEnd = after.length;
  while (start < beforeEnd && start < afterEnd && before[start] === after[start]) start++;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd--; afterEnd--; }
  const oldMiddle = before.slice(start, beforeEnd);
  const newMiddle = after.slice(start, afterEnd);
  if (!oldMiddle.length) return newMiddle.join('');
  if (!newMiddle.length) return '';
  if ((oldMiddle.length + 1) * (newMiddle.length + 1) <= MAX_MATRIX_CELLS) {
    return matrixAdditions(oldMiddle, newMiddle);
  }
  return nearbyAdditions(oldMiddle, newMiddle) ?? longAdditions(oldMiddle, newMiddle);
}

/** Split an immutable generated label from editable personal additions. */
export function getMindmapText(node) {
  const original = typeof node.originalLabel === 'string' ? node.originalLabel : node.label;
  // An explicit empty value means "cleared", not "try legacy migration again".
  const addition = typeof node.userText === 'string' ? node.userText : addedText(original, node.label);
  return { original, addition };
}

/** Normalize legacy edits without mutating the caller's node or its metadata. */
export function normalizeMindmapNode(node) {
  const { original, addition } = getMindmapText(node);
  return { ...node, label: original, userText: addition };
}
