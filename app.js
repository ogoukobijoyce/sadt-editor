/* ============================================================
   SADT Editor — app.js
   Canvas-based interactive SADT diagram editor (vanilla JS)
   ============================================================ */
'use strict';

// ─── Constants ───────────────────────────────────────────────
const RECT_W_DEFAULT  = 160;
const RECT_H_DEFAULT  = 80;
const RECT_MIN_W      = 60;
const RECT_MIN_H      = 40;
const SNAP_RADIUS     = 18;   // px – snap to border threshold
const HANDLE_SIZE     = 8;    // px – resize-handle square side
const ARROW_HEAD_LEN  = 14;   // px
const ARROW_HEAD_ANG  = Math.PI / 6;  // 30°
const GRID_STEP       = 20;   // px
const CHILD_PADDING   = 20;   // px – minimum gap between child and parent border
const PARENT_LABEL_H  = 28;   // px – reserved height at top of parent for its label

const ARROW_COLORS = {
  input:     '#2196F3',   // blue
  output:    '#4CAF50',   // green
  control:   '#F44336',   // red
  mechanism: '#FF9800',   // orange
  connected: '#4b5563',   // dark grey – rect-to-rect connection
};

const TYPE_LABELS = {
  input:     'Entrée',
  output:    'Sortie',
  control:   'Contrôle',
  mechanism: 'Mécanisme',
  connected: 'Connexion',
};

const MODE_HINTS = {
  select:         'Cliquez pour sélectionner · Glissez pour déplacer · Double-clic pour renommer · Suppr pour effacer',
  'add-rect':     'Cliquez sur le canvas pour placer un rectangle.',
  'add-arrow':    'Cliquez sur un bord de rectangle (ou n\'importe où) pour démarrer la flèche, puis cliquez pour terminer. Échap pour annuler.',
  'add-free-arrow': 'Cliquez pour démarrer la flèche libre, puis cliquez pour terminer. Échap pour annuler.',
};

// ─── DOM references ──────────────────────────────────────────
const canvasEl    = document.getElementById('canvas');
const ctx         = canvasEl.getContext('2d');
const container   = document.getElementById('canvas-container');
const labelEditor = document.getElementById('label-editor');
const labelInput  = document.getElementById('label-input');
const statusMode  = document.getElementById('status-mode');
const statusHint  = document.getElementById('status-hint');
const statusSel   = document.getElementById('status-sel');

// ─── Application state ───────────────────────────────────────
let rects  = [];   // Array<Rect>
let arrows = [];   // Array<Arrow>
let _id    = 1;
function uid() { return 'e' + (_id++); }

/*
 * Rect  { id, x, y, width, height, label, parentId }
 * Arrow { id, label, arrowType,
 *         startRectId, startAnchor,   // anchor = { side, t }
 *         startX, startY,             // fallback / free endpoint
 *         endRectId,   endAnchor,
 *         endX,   endY }
 */

let mode          = 'select';
let freeArrowType = 'input';   // used in 'add-free-arrow' mode

let selectedId   = null;
let selectedType = null;   // 'rect' | 'arrow'

// Drag
let isDragging = false;
let dragInfo   = null;   // { id, ox, oy }

// Resize
let isResizing = false;
let resizeInfo = null;   // { id, handle, mx0, my0, orig }

// Arrow drawing (2-click interaction)
let arrowDraw = null;
// { startX, startY, startRectId, startAnchor, curX, curY }

// Detect click vs drag
let mdX = 0, mdY = 0, moved = false;

// Inline text editing
let editId   = null;
let editType = null;

// ─── Geometry helpers ────────────────────────────────────────

function getAnchorXY(rect, anchor) {
  const { x, y, width: w, height: h } = rect;
  switch (anchor.side) {
    case 'left':   return { x,     y: y + anchor.t * h };
    case 'right':  return { x: x + w, y: y + anchor.t * h };
    case 'top':    return { x: x + anchor.t * w, y };
    case 'bottom': return { x: x + anchor.t * w, y: y + h };
    default:       return { x, y };
  }
}

function getArrowEndpoints(arrow) {
  let x1, y1, x2, y2;

  if (arrow.startRectId) {
    const r = rects.find(r => r.id === arrow.startRectId);
    if (r) { const p = getAnchorXY(r, arrow.startAnchor); x1 = p.x; y1 = p.y; }
    else   { x1 = arrow.startX; y1 = arrow.startY; }
  } else { x1 = arrow.startX; y1 = arrow.startY; }

  if (arrow.endRectId) {
    const r = rects.find(r => r.id === arrow.endRectId);
    if (r) { const p = getAnchorXY(r, arrow.endAnchor); x2 = p.x; y2 = p.y; }
    else   { x2 = arrow.endX; y2 = arrow.endY; }
  } else { x2 = arrow.endX; y2 = arrow.endY; }

  return { x1, y1, x2, y2 };
}

/** Compute the label position beside an arrow (offset perpendicular to the arrow). */
function getArrowLabelPos(arrow) {
  const { x1, y1, x2, y2 } = getArrowEndpoints(arrow);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Clockwise 90° perpendicular: (dy/len, -dx/len).
  // For a right-going arrow (dx>0, dy≈0) this points upward,
  // placing the label above the line — the natural reading position.
  const nx = dy / len;
  const ny = -dx / len;
  return { x: mx + nx * 16, y: my + ny * 16 };
}

/** Find nearest rect border point within SNAP_RADIUS.
 *  Returns { rectId, anchor, x, y } or null. */
function findSnap(mx, my, excludeId = null) {
  let best = null, bestD = SNAP_RADIUS;

  for (const rect of rects) {
    if (rect.id === excludeId) continue;
    const { x, y, width: w, height: h } = rect;

    // Left / Right (vertical sides) – snap if y is within rect
    if (my >= y && my <= y + h) {
      let d = Math.abs(mx - x);
      if (d < bestD) {
        bestD = d;
        best = { rectId: rect.id, anchor: { side: 'left',  t: (my - y) / h }, x, y: my };
      }
      d = Math.abs(mx - (x + w));
      if (d < bestD) {
        bestD = d;
        best = { rectId: rect.id, anchor: { side: 'right', t: (my - y) / h }, x: x + w, y: my };
      }
    }

    // Top / Bottom (horizontal sides) – snap if x is within rect
    if (mx >= x && mx <= x + w) {
      let d = Math.abs(my - y);
      if (d < bestD) {
        bestD = d;
        best = { rectId: rect.id, anchor: { side: 'top',    t: (mx - x) / w }, x: mx, y };
      }
      d = Math.abs(my - (y + h));
      if (d < bestD) {
        bestD = d;
        best = { rectId: rect.id, anchor: { side: 'bottom', t: (mx - x) / w }, x: mx, y: y + h };
      }
    }
  }

  return best;
}

// Distance from point (px,py) to segment (x1,y1)-(x2,y2)
function ptSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function rectHandles(rect) {
  const { x, y, width: w, height: h } = rect;
  return [
    { handle: 'nw', x: x,     y: y     },
    { handle: 'ne', x: x + w, y: y     },
    { handle: 'se', x: x + w, y: y + h },
    { handle: 'sw', x: x,     y: y + h },
  ];
}

// ─── Hit testing ─────────────────────────────────────────────

function hitRect(mx, my) {
  const order = getRenderOrder();
  for (let i = order.length - 1; i >= 0; i--) {
    const r = order[i];
    if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height)
      return r.id;
  }
  return null;
}

function hitArrow(mx, my) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    const { x1, y1, x2, y2 } = getArrowEndpoints(a);
    if (ptSegDist(mx, my, x1, y1, x2, y2) < 6) return a.id;
  }
  return null;
}

function hitArrowLabel(mx, my) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (!a.label) continue;
    const { x, y } = getArrowLabelPos(a);
    if (Math.hypot(mx - x, my - y) < 20) return a.id;
  }
  return null;
}

function hitHandle(mx, my, rect) {
  const half = HANDLE_SIZE / 2 + 2;
  for (const h of rectHandles(rect)) {
    if (Math.abs(mx - h.x) <= half && Math.abs(my - h.y) <= half) return h.handle;
  }
  return null;
}

// ─── Rendering ───────────────────────────────────────────────

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = '#e4e7ec';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= canvasEl.width; x += GRID_STEP) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasEl.height); ctx.stroke();
  }
  for (let y = 0; y <= canvasEl.height; y += GRID_STEP) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasEl.width, y); ctx.stroke();
  }
  ctx.restore();
}

function drawArrowHead(x, y, angle) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - ARROW_HEAD_LEN * Math.cos(angle - ARROW_HEAD_ANG),
    y - ARROW_HEAD_LEN * Math.sin(angle - ARROW_HEAD_ANG)
  );
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - ARROW_HEAD_LEN * Math.cos(angle + ARROW_HEAD_ANG),
    y - ARROW_HEAD_LEN * Math.sin(angle + ARROW_HEAD_ANG)
  );
  ctx.stroke();
}

function wrapText(text, maxWidth) {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = word;
    } else { line = test; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawRect(rect, selected) {
  ctx.save();
  const { x, y, width: w, height: h, label } = rect;
  const isParent = rects.some(r => r.parentId === rect.id);

  if (selected) { ctx.shadowColor = '#3b82f6'; ctx.shadowBlur = 10; }

  // Visual style: parent rects have a blue-tinted background and thicker border
  ctx.fillStyle   = isParent ? '#eef6ff' : '#ffffff';
  ctx.strokeStyle = selected ? (isParent ? '#1d4ed8' : '#2563eb') : (isParent ? '#1e40af' : '#374151');
  ctx.lineWidth   = selected ? (isParent ? 3 : 2.5) : (isParent ? 2 : 1.5);

  // Rounded rect (with fallback for older browsers)
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, 4); }
  else               { ctx.rect(x, y, w, h); }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Horizontal separator below the label area for parent rects
  if (isParent) {
    ctx.strokeStyle = selected ? '#1d4ed8' : '#93c5fd';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + PARENT_LABEL_H);
    ctx.lineTo(x + w - 2, y + PARENT_LABEL_H);
    ctx.stroke();
  }

  // Label: pinned to the top header for parents, centred for leaf rects
  ctx.font         = 'bold 13px Arial, sans-serif';
  ctx.fillStyle    = '#111827';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  if (isParent) {
    ctx.fillText(label || 'Fonction', x + w / 2, y + PARENT_LABEL_H / 2, w - 12);
  } else {
    const lines = wrapText(label || 'Fonction', w - 16);
    const lh    = 17;
    let lineY   = y + h / 2 - (lines.length * lh) / 2 + lh / 2;
    for (const ln of lines) {
      ctx.fillText(ln, x + w / 2, lineY, w - 12);
      lineY += lh;
    }
  }

  // Resize handles
  if (selected) {
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#2563eb';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    for (const h of rectHandles(rect)) {
      ctx.beginPath();
      ctx.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill(); ctx.stroke();
    }
  }

  ctx.restore();
}

function drawArrow(arrow, selected) {
  const { x1, y1, x2, y2 } = getArrowEndpoints(arrow);
  const color = ARROW_COLORS[arrow.arrowType] || ARROW_COLORS.connected;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = selected ? 2.5 : 2;

  if (selected) { ctx.shadowColor = color; ctx.shadowBlur = 6; }

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawArrowHead(x2, y2, Math.atan2(y2 - y1, x2 - x1));

  // Label beside the arrow (offset perpendicular to its direction)
  if (arrow.label) {
    const { x: lx, y: ly } = getArrowLabelPos(arrow);
    ctx.font = '11.5px Arial, sans-serif';
    const tw = ctx.measureText(arrow.label).width;
    const pad = 4;
    const bx = lx - tw / 2 - pad, by = ly - 9;
    ctx.fillStyle   = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(bx, by, tw + pad * 2, 18, 3); }
    else               { ctx.rect(bx, by, tw + pad * 2, 18); }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle    = color;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrow.label, lx, ly);
  }

  ctx.restore();
}

/** Return rects sorted so that parents are drawn before their children (topological order). */
function getRenderOrder() {
  const result = [];
  const visited = new Set();

  function visit(r) {
    if (visited.has(r.id)) return;
    visited.add(r.id);
    result.push(r);
    for (const child of rects) {
      if (child.parentId === r.id) visit(child);
    }
  }

  // Start with top-level rects (no parent or orphaned)
  for (const r of rects) {
    if (!r.parentId || !rects.find(p => p.id === r.parentId)) visit(r);
  }
  // Safety: include any not yet visited
  for (const r of rects) visit(r);

  return result;
}

function render() {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

  drawGrid();

  // Arrows below rects
  for (const a of arrows)
    drawArrow(a, selectedType === 'arrow' && a.id === selectedId);

  // Rectangles drawn in topological order: parents first, children on top
  const renderOrder = getRenderOrder();
  for (const r of renderOrder)
    drawRect(r, selectedType === 'rect' && r.id === selectedId);

  // Arrow-draw preview
  if (arrowDraw) {
    const { startX, startY, curX, curY } = arrowDraw;
    const color = (mode === 'add-arrow') ? ARROW_COLORS.connected : (ARROW_COLORS[freeArrowType] || '#555');

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([7, 4]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(curX, curY);
    ctx.stroke();
    ctx.setLineDash([]);
    drawArrowHead(curX, curY, Math.atan2(curY - startY, curX - startX));

    // Start anchor dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(startX, startY, 4, 0, Math.PI * 2);
    ctx.fill();

    // End snap indicator
    const snap = findSnap(curX, curY, arrowDraw.startRectId);
    if (snap) {
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(snap.x, snap.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ─── Canvas sizing ───────────────────────────────────────────

function resizeCanvas() {
  canvasEl.width  = container.clientWidth;
  canvasEl.height = container.clientHeight;
  render();
}

// ─── Cursor ──────────────────────────────────────────────────

function updateCursor(mx, my) {
  if (mode !== 'select') {
    canvasEl.style.cursor = 'crosshair';
    return;
  }
  if (selectedType === 'rect') {
    const sr = rects.find(r => r.id === selectedId);
    if (sr) {
      const h = hitHandle(mx, my, sr);
      if (h) {
        const map = { nw: 'nw-resize', ne: 'ne-resize', se: 'se-resize', sw: 'sw-resize' };
        canvasEl.style.cursor = map[h];
        return;
      }
    }
  }
  if (hitRect(mx, my))  { canvasEl.style.cursor = 'grab';    return; }
  if (hitArrow(mx, my)) { canvasEl.style.cursor = 'pointer'; return; }
  canvasEl.style.cursor = 'default';
}

// ─── Status bar ──────────────────────────────────────────────

function updateStatus() {
  if (!selectedId) { statusSel.textContent = ''; return; }
  if (selectedType === 'rect') {
    const r = rects.find(r => r.id === selectedId);
    statusSel.textContent = r ? `Rectangle : « ${r.label} »` : '';
  } else {
    const a = arrows.find(a => a.id === selectedId);
    if (a) {
      const typeLabel = TYPE_LABELS[a.arrowType] || a.arrowType;
      statusSel.textContent = `Flèche (${typeLabel})${a.label ? ' : « ' + a.label + ' »' : ''}`;
    }
  }
}

// ─── Mode management ─────────────────────────────────────────

function setMode(newMode) {
  mode      = newMode;
  arrowDraw = null;

  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const ids = { select: 'btn-select', 'add-rect': 'btn-add-rect', 'add-arrow': 'btn-add-arrow', 'add-free-arrow': 'btn-add-free-arrow' };
  if (ids[newMode]) document.getElementById(ids[newMode]).classList.add('active');

  const names = { select: 'Sélection', 'add-rect': 'Ajouter un rectangle', 'add-arrow': 'Dessiner une flèche', 'add-free-arrow': 'Flèche libre' };
  statusMode.textContent = 'Mode : ' + (names[newMode] || newMode);
  statusHint.textContent = MODE_HINTS[newMode] || '';

  render();
}

// ─── Actions ─────────────────────────────────────────────────

function addRect(x, y) {
  const rect = {
    id:       uid(),
    x:        x - RECT_W_DEFAULT / 2,
    y:        y - RECT_H_DEFAULT / 2,
    width:    RECT_W_DEFAULT,
    height:   RECT_H_DEFAULT,
    label:    'Fonction',
    parentId: null,
  };
  rects.push(rect);
  selectedId   = rect.id;
  selectedType = 'rect';
  render();
  updateStatus();
}

function finishArrow(endX, endY, snap) {
  const { startX, startY, startRectId, startAnchor } = arrowDraw;

  // Determine arrowType
  let arrowType;
  if (mode === 'add-arrow') {
    arrowType = 'connected';
  } else {
    arrowType = freeArrowType;
  }

  arrows.push({
    id:           uid(),
    label:        '',
    arrowType,
    startRectId:  startRectId  || null,
    startAnchor:  startAnchor  || null,
    startX,
    startY,
    endRectId:    snap ? snap.rectId : null,
    endAnchor:    snap ? snap.anchor : null,
    endX:         snap ? snap.x : endX,
    endY:         snap ? snap.y : endY,
  });

  arrowDraw    = null;
  selectedId   = arrows[arrows.length - 1].id;
  selectedType = 'arrow';
  render();
  updateStatus();
  statusHint.textContent = 'Flèche créée. Double-cliquez sur la flèche pour l\'étiqueter.';
  setTimeout(() => { if (statusHint.textContent.startsWith('Flèche créée')) statusHint.textContent = MODE_HINTS[mode] || ''; }, 3000);
}

function deleteSelected() {
  if (!selectedId) return;
  if (selectedType === 'rect') {
    // Unparent direct children before removing the rect
    for (const r of rects) {
      if (r.parentId === selectedId) r.parentId = null;
    }
    rects  = rects.filter(r => r.id !== selectedId);
    arrows = arrows.filter(a => a.startRectId !== selectedId && a.endRectId !== selectedId);
  } else {
    arrows = arrows.filter(a => a.id !== selectedId);
  }
  selectedId = selectedType = null;
  render();
  updateStatus();
}

// ─── Nested-rectangle helpers ────────────────────────────────

/** Recursively collect ids of all descendants of a rect. */
function getDescendants(id) {
  const result = new Set();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const r of rects) {
      if (r.parentId === cur) { result.add(r.id); queue.push(r.id); }
    }
  }
  return result;
}

/** Move all direct and indirect children of parentId by (dx, dy). */
function moveChildren(parentId, dx, dy) {
  for (const r of rects) {
    if (r.parentId === parentId) {
      r.x += dx;
      r.y += dy;
      moveChildren(r.id, dx, dy);
    }
  }
}

/** Expand parent rect so that child fits inside it (with padding).
 *  Recursively expands ancestor chain if needed. */
function expandParentForChild(parent, child) {
  const reqLeft   = child.x - CHILD_PADDING;
  // Extra CHILD_PADDING below the header separator, matching the bottom/side gaps
  const reqTop    = child.y - PARENT_LABEL_H - CHILD_PADDING;
  const reqRight  = child.x + child.width  + CHILD_PADDING;
  const reqBottom = child.y + child.height + CHILD_PADDING;

  let changed = false;

  if (reqLeft < parent.x) {
    const d = parent.x - reqLeft;
    parent.x -= d; parent.width += d;
    changed = true;
  }
  if (reqTop < parent.y) {
    const d = parent.y - reqTop;
    parent.y -= d; parent.height += d;
    changed = true;
  }
  if (reqRight > parent.x + parent.width) {
    parent.width = reqRight - parent.x;
    changed = true;
  }
  if (reqBottom > parent.y + parent.height) {
    parent.height = reqBottom - parent.y;
    changed = true;
  }

  if (changed && parent.parentId) {
    const gp = rects.find(r => r.id === parent.parentId);
    if (gp) expandParentForChild(gp, parent);
  }
}

/** Add a sub-rectangle centred inside the selected parent rect. */
function addSubRect(parentId) {
  const parent = rects.find(r => r.id === parentId);
  if (!parent) return;

  // Ensure the parent is large enough: header + top-padding + child + bottom-padding
  const minW = RECT_W_DEFAULT + 2 * CHILD_PADDING;
  const minH = RECT_H_DEFAULT + PARENT_LABEL_H + 2 * CHILD_PADDING;
  if (parent.width  < minW) parent.width  = minW;
  if (parent.height < minH) parent.height = minH;

  // Centre the child in the interior area (below the header separator + top gap)
  const interiorTop    = parent.y + PARENT_LABEL_H + CHILD_PADDING;
  const availableH     = parent.height - PARENT_LABEL_H - 2 * CHILD_PADDING - RECT_H_DEFAULT;
  const availableW     = parent.width  - 2 * CHILD_PADDING - RECT_W_DEFAULT;
  const childX = parent.x + CHILD_PADDING + Math.max(0, availableW) / 2;
  const childY = interiorTop              + Math.max(0, availableH) / 2;

  const rect = {
    id:       uid(),
    x:        childX,
    y:        childY,
    width:    RECT_W_DEFAULT,
    height:   RECT_H_DEFAULT,
    label:    'Sous-fonction',
    parentId: parentId,
  };
  rects.push(rect);
  selectedId   = rect.id;
  selectedType = 'rect';
  render();
  updateStatus();
}

// ─── Drag & Resize ───────────────────────────────────────────

function doDrag(mx, my) {
  if (!dragInfo) return;
  const r = rects.find(r => r.id === dragInfo.id);
  if (!r) return;
  const newX = mx - dragInfo.ox;
  const newY = my - dragInfo.oy;
  const dx = newX - r.x;
  const dy = newY - r.y;
  r.x = newX;
  r.y = newY;
  // Move all children (direct and indirect) by the same delta
  moveChildren(r.id, dx, dy);
  // If this rect is a child, expand its parent if it drifts toward the edge
  if (r.parentId) {
    const parent = rects.find(p => p.id === r.parentId);
    if (parent) expandParentForChild(parent, r);
  }
}

function doResize(mx, my) {
  if (!resizeInfo) return;
  const r = rects.find(r => r.id === resizeInfo.id);
  if (!r) return;
  const { orig, handle, mx0, my0 } = resizeInfo;
  const dx = mx - mx0, dy = my - my0;

  switch (handle) {
    case 'nw': {
      const nw = Math.max(RECT_MIN_W, orig.width  - dx);
      const nh = Math.max(RECT_MIN_H, orig.height - dy);
      r.x = orig.x + orig.width  - nw;
      r.y = orig.y + orig.height - nh;
      r.width = nw; r.height = nh;
      break;
    }
    case 'ne': {
      const nh = Math.max(RECT_MIN_H, orig.height - dy);
      r.y = orig.y + orig.height - nh;
      r.width  = Math.max(RECT_MIN_W, orig.width + dx);
      r.height = nh;
      break;
    }
    case 'se':
      r.width  = Math.max(RECT_MIN_W, orig.width  + dx);
      r.height = Math.max(RECT_MIN_H, orig.height + dy);
      break;
    case 'sw': {
      const nw = Math.max(RECT_MIN_W, orig.width  - dx);
      r.x     = orig.x + orig.width - nw;
      r.width = nw;
      r.height = Math.max(RECT_MIN_H, orig.height + dy);
      break;
    }
    default: break;
  }
}

// ─── Inline text editing ─────────────────────────────────────

function startEditRect(id) {
  const r = rects.find(r => r.id === id);
  if (!r) return;
  editId   = id;
  editType = 'rect';
  labelInput.value = r.label || '';
  positionEditor(r.x, r.y + r.height / 2 - 14, r.width, 28);
  labelEditor.style.display = 'block';
  labelInput.focus();
  labelInput.select();
}

function startEditArrow(id) {
  const a = arrows.find(a => a.id === id);
  if (!a) return;
  editId   = id;
  editType = 'arrow';
  labelInput.value = a.label || '';
  const { x: lx, y: ly } = getArrowLabelPos(a);
  positionEditor(lx - 70, ly - 14, 140, 28);
  labelEditor.style.display = 'block';
  labelInput.focus();
  labelInput.select();
}

function positionEditor(x, y, w, h) {
  labelEditor.style.left   = x + 'px';
  labelEditor.style.top    = y + 'px';
  labelEditor.style.width  = w + 'px';
  labelEditor.style.height = h + 'px';
}

function finishEditing() {
  if (!editId) return;
  const val = labelInput.value.trim();
  if (editType === 'rect') {
    const r = rects.find(r => r.id === editId);
    if (r) r.label = val;
  } else {
    const a = arrows.find(a => a.id === editId);
    if (a) a.label = val;
  }
  editId = editType = null;
  labelEditor.style.display = 'none';
  render();
  updateStatus();
}

function cancelEditing() {
  editId = editType = null;
  labelEditor.style.display = 'none';
}

// ─── Save / Load / Export ────────────────────────────────────

function saveJSON() {
  const data = JSON.stringify({ rects, arrows, nextId: _id }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sadt-diagram.json'; a.click();
  URL.revokeObjectURL(url);
}

function loadJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      rects  = data.rects  || [];
      arrows = data.arrows || [];
      const allNums = [...rects, ...arrows]
        .map(o => parseInt(o.id.replace(/^\D+/, ''), 10))
        .filter(n => !isNaN(n));
      _id = allNums.length ? Math.max(...allNums) + 1 : 1;
      if (data.nextId && data.nextId > _id) _id = data.nextId;
      selectedId = selectedType = null;
      setMode('select');
      render();
      updateStatus();
    } catch (err) {
      alert('Erreur lors du chargement : ' + err.message);
    }
  };
  reader.readAsText(file);
}

function exportPNG() {
  // Temporarily clear selection for a clean export
  const prevId = selectedId, prevType = selectedType;
  selectedId = selectedType = null;
  render();
  const url = canvasEl.toDataURL('image/png');
  const a   = document.createElement('a');
  a.href = url; a.download = 'sadt-diagram.png'; a.click();
  selectedId = prevId; selectedType = prevType;
  render();
}

// ─── Mouse helpers ───────────────────────────────────────────

function getPos(e) {
  const rect = canvasEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ─── Mouse events ────────────────────────────────────────────

canvasEl.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (editId) finishEditing();
  const { x, y } = getPos(e);
  mdX = x; mdY = y; moved = false;

  // ── Select mode ─────────────────────────────────────────────
  if (mode === 'select') {
    // Resize handle?
    if (selectedType === 'rect') {
      const sr = rects.find(r => r.id === selectedId);
      if (sr) {
        const h = hitHandle(x, y, sr);
        if (h) {
          isResizing = true;
          resizeInfo = { id: sr.id, handle: h, mx0: x, my0: y, orig: { ...sr } };
          return;
        }
      }
    }

    // Rect?
    const rId = hitRect(x, y);
    if (rId) {
      const r = rects.find(r => r.id === rId);
      selectedId   = rId;
      selectedType = 'rect';
      isDragging   = true;
      dragInfo     = { id: rId, ox: x - r.x, oy: y - r.y };
      render(); updateStatus(); return;
    }

    // Arrow?
    const aId = hitArrow(x, y);
    if (aId) {
      selectedId   = aId;
      selectedType = 'arrow';
      render(); updateStatus(); return;
    }

    // Deselect
    selectedId = selectedType = null;
    render(); updateStatus();
    return;
  }

  // ── Add-rect mode ────────────────────────────────────────────
  if (mode === 'add-rect') {
    addRect(x, y);
    setMode('select');
    return;
  }

  // ── Arrow-drawing modes ──────────────────────────────────────
  if (mode === 'add-arrow' || mode === 'add-free-arrow') {
    if (!arrowDraw) {
      // First click: start arrow
      const snap = findSnap(x, y);
      arrowDraw = snap
        ? { startX: snap.x, startY: snap.y, startRectId: snap.rectId, startAnchor: snap.anchor, curX: snap.x, curY: snap.y }
        : { startX: x, startY: y, startRectId: null, startAnchor: null, curX: x, curY: y };
      render();
    } else {
      // Second click: end arrow
      const snap = findSnap(x, y, arrowDraw.startRectId);
      finishArrow(x, y, snap);
    }
  }
});

canvasEl.addEventListener('mousemove', e => {
  const { x, y } = getPos(e);
  if (Math.abs(x - mdX) > 3 || Math.abs(y - mdY) > 3) moved = true;

  if (isResizing && resizeInfo) { doResize(x, y); render(); return; }
  if (isDragging && dragInfo)   { doDrag(x, y);   render(); return; }

  if (arrowDraw) {
    const snap = findSnap(x, y, arrowDraw.startRectId);
    arrowDraw.curX = snap ? snap.x : x;
    arrowDraw.curY = snap ? snap.y : y;
    render();
  }

  updateCursor(x, y);
});

canvasEl.addEventListener('mouseup', e => {
  if (e.button !== 0) return;

  // Drag-to-nest: when a rect is dropped, determine its parent by position
  if (isDragging && dragInfo && moved) {
    const dragged = rects.find(r => r.id === dragInfo.id);
    if (dragged) {
      const cx = dragged.x + dragged.width  / 2;
      const cy = dragged.y + dragged.height / 2;
      const descendants = getDescendants(dragged.id);
      let newParentId = null;

      // Find the innermost (topmost-drawn) rect that contains the centre
      const order = getRenderOrder();
      for (let i = order.length - 1; i >= 0; i--) {
        const r = order[i];
        if (r.id === dragged.id || descendants.has(r.id)) continue;
        if (cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) {
          newParentId = r.id;
          break;
        }
      }

      if (newParentId !== dragged.parentId) {
        dragged.parentId = newParentId;
        if (newParentId) {
          const newParent = rects.find(r => r.id === newParentId);
          if (newParent) expandParentForChild(newParent, dragged);
        }
        render();
      }
    }
  }

  isDragging = false; dragInfo   = null;
  isResizing = false; resizeInfo = null;
});

canvasEl.addEventListener('dblclick', e => {
  const { x, y } = getPos(e);
  if (mode !== 'select') return;

  const rId = hitRect(x, y);
  if (rId) { startEditRect(rId); return; }

  const aId = hitArrowLabel(x, y) || hitArrow(x, y);
  if (aId) { startEditArrow(aId); return; }
});

// ─── Label input events ──────────────────────────────────────

labelInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { finishEditing(); }
  if (e.key === 'Escape') { cancelEditing(); }
  e.stopPropagation();
});
labelInput.addEventListener('blur', finishEditing);

// ─── Keyboard shortcuts ──────────────────────────────────────

document.addEventListener('keydown', e => {
  if (editId) return;  // Let text input handle keys

  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveJSON(); return; }

  switch (e.key) {
    case 'Delete':
    case 'Backspace': deleteSelected(); break;

    case 'Escape':
      if (arrowDraw) { arrowDraw = null; render(); }
      else if (mode !== 'select') { setMode('select'); }
      else { selectedId = selectedType = null; render(); updateStatus(); }
      break;

    case 's': case 'S': if (!e.ctrlKey && !e.metaKey) setMode('select'); break;
    case 'r': case 'R': setMode('add-rect'); break;
    case 'a': case 'A': setMode('add-arrow'); break;
    case 'f': case 'F': setMode('add-free-arrow'); break;
  }
});

// ─── Toolbar wiring ──────────────────────────────────────────

function setupToolbar() {
  document.getElementById('btn-select').addEventListener('click',          () => setMode('select'));
  document.getElementById('btn-add-rect').addEventListener('click',        () => setMode('add-rect'));
  document.getElementById('btn-add-arrow').addEventListener('click',       () => setMode('add-arrow'));
  document.getElementById('btn-add-free-arrow').addEventListener('click',  () => setMode('add-free-arrow'));
  document.getElementById('btn-delete').addEventListener('click',          deleteSelected);
  document.getElementById('btn-save').addEventListener('click',            saveJSON);
  document.getElementById('btn-export-png').addEventListener('click',      exportPNG);

  document.getElementById('btn-add-sub-rect').addEventListener('click', () => {
    if (selectedType === 'rect') {
      addSubRect(selectedId);
    } else {
      statusHint.textContent = 'Sélectionnez d\'abord un rectangle pour y ajouter un sous-rectangle.';
      setTimeout(() => { statusHint.textContent = MODE_HINTS[mode] || ''; }, 3000);
    }
  });

  document.getElementById('btn-load').addEventListener('click', () =>
    document.getElementById('file-input').click()
  );
  document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files[0]) { loadJSON(e.target.files[0]); e.target.value = ''; }
  });

  document.getElementById('arrow-type-select').addEventListener('change', e => {
    freeArrowType = e.target.value;
  });
}

// ─── Initialisation ──────────────────────────────────────────

function init() {
  resizeCanvas();
  setupToolbar();
  setMode('select');

  // Re-size when container changes
  new ResizeObserver(resizeCanvas).observe(container);
}

init();
