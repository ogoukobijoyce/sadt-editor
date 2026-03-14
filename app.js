/* ============================================================
   SADT Editor Pro — app.js
   Canvas-based interactive SADT diagram editor (vanilla JS)
   ============================================================ */
'use strict';

// ─── Constants ───────────────────────────────────────────────
const RECT_W_DEFAULT  = 160;
const RECT_H_DEFAULT  = 80;
const RECT_MIN_W      = 60;
const RECT_MIN_H      = 40;
const SNAP_RADIUS     = 18;
const HANDLE_SIZE     = 8;
const ARROW_HEAD_LEN  = 14;
const ARROW_HEAD_ANG  = Math.PI / 6;
const GRID_STEP       = 20;
const CHILD_PADDING   = 20;
const PARENT_LABEL_H  = 28;

const LAYOUT_H_SPACING  = 100;
const LAYOUT_V_SPACING  = 80;
const LAYOUT_PADDING    = 80;
const STATUS_MSG_DELAY  = 4000;
const COORD_EPSILON     = 1;
const MAX_OBSTACLE_ITER = 10;

const ZOOM_MIN    = 0.1;
const ZOOM_MAX    = 5.0;
const ZOOM_FACTOR = 1.15;

const ARROW_COLORS = {
  input:     '#2196F3',
  output:    '#4CAF50',
  control:   '#F44336',
  mechanism: '#FF9800',
  connected: '#4b5563',
};

const TYPE_LABELS = {
  input:     'Entrée',
  output:    'Sortie',
  control:   'Contrôle',
  mechanism: 'Mécanisme',
  connected: 'Connexion',
};

const MODE_HINTS = {
  select:           'Cliquer pour sélectionner · Glisser pour déplacer · N=renommer · Ctrl+DblClic=actigramme · Suppr=supprimer',
  'add-rect':       'Cliquer sur le canvas pour placer une fonction.',
  'add-arrow':      'Cliquer sur un bord de fonction pour démarrer, puis cliquer pour terminer. Échap pour annuler.',
  'add-free-arrow': 'Cliquer pour démarrer la flèche SADT, puis cliquer pour terminer. Échap pour annuler.',
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

// ─── Tab system ──────────────────────────────────────────────

let _tabSeq = 0;

function createTab(label, type, parentRectId) {
  type         = type         || 'actigramme';
  parentRectId = parentRectId || null;
  return {
    id:           'tab-' + (++_tabSeq),
    label,
    type,
    parentRectId,
    rects:        [],
    arrows:       [],
    nextId:       1,
    history:      [],
    historyIdx:   -1,
    selId:        null,
    selType:      null,
  };
}

const tabs       = [createTab('Top-Level', 'top-level', null)];
let currentTabId = tabs[0].id;

function currentTab() {
  return tabs.find(t => t.id === currentTabId) || tabs[0];
}

// ─── Application state ───────────────────────────────────────
let rects  = tabs[0].rects;
let arrows = tabs[0].arrows;
let _id    = 1;

function uid() { return 'e' + (_id++); }

let mode          = 'select';
let freeArrowType = 'input';

let selectedId   = null;
let selectedType = null;

// Display toggles
let showGrid   = true;
let snapToGrid = true;

// Drag
let isDragging = false;
let dragInfo   = null;

// Resize
let isResizing = false;
let resizeInfo = null;

// Arrow drawing
let arrowDraw = null;

// Waypoint dragging
let waypointDrag = null;

// Click vs drag detection
let mdX = 0, mdY = 0, moved = false;

// Inline text editing
let editId   = null;
let editType = null;

// Clipboard
let clipboard = null;

// ─── Viewport (zoom / pan) ───────────────────────────────────
let viewScale   = 1.0;
let viewOffsetX = 0;
let viewOffsetY = 0;

// Middle-mouse panning
let isPanning  = false;
let panStartX  = 0;
let panStartY  = 0;
let panStartOX = 0;
let panStartOY = 0;

// ─── Tab management ──────────────────────────────────────────

function switchToTab(tabId) {
  const curTab   = currentTab();
  curTab.nextId  = _id;
  curTab.selId   = selectedId;
  curTab.selType = selectedType;

  currentTabId = tabId;
  const newTab = currentTab();
  rects        = newTab.rects;
  arrows       = newTab.arrows;
  _id          = newTab.nextId;
  selectedId   = newTab.selId;
  selectedType = newTab.selType;

  renderTabBar();
  render();
  updateStatus();
  updateNavBar();
}

function addNewTab(label, type, parentRectId) {
  const tab = createTab(label, type || 'actigramme', parentRectId || null);
  tabs.push(tab);
  switchToTab(tab.id);
}

function closeTab(tabId) {
  if (tabs.length <= 1) { showStatusMsg('Impossible de fermer le dernier onglet.'); return; }
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  switchToTab(tabs[Math.min(idx, tabs.length - 1)].id);
}

function openActigramme(rect) {
  if (!rect) return;
  const existing = tabs.find(t => t.parentRectId === rect.id);
  if (existing) { switchToTab(existing.id); return; }
  addNewTab('Actigramme : ' + (rect.label || rect.id), 'actigramme', rect.id);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTabBar() {
  const tabBar    = document.getElementById('tab-bar');
  const btnNewTab = document.getElementById('btn-new-tab');
  tabBar.querySelectorAll('.canvas-tab').forEach(el => el.remove());

  tabs.forEach(tab => {
    const div = document.createElement('div');
    div.className      = 'canvas-tab' + (tab.id === currentTabId ? ' active' : '');
    div.dataset.tabId  = tab.id;
    const badge        = tab.type === 'top-level' ? 'A-0' : 'A';
    div.innerHTML =
      '<span class="tab-label">' + escapeHtml(tab.label) + '</span>' +
      '<span class="tab-type-badge">' + badge + '</span>' +
      '<button class="tab-close" title="Fermer">\u00D7</button>';

    div.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close')) return;
      switchToTab(tab.id);
    });
    div.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation(); closeTab(tab.id);
    });
    tabBar.insertBefore(div, btnNewTab);
  });
}

function updateNavBar() {
  const badge = document.getElementById('nav-level-badge');
  if (badge) badge.textContent = currentTab().label;
}

// ─── History (Undo / Redo) ───────────────────────────────────

function saveHistory() {
  const tab = currentTab();
  tab.history    = tab.history.slice(0, tab.historyIdx + 1);
  tab.history.push(JSON.stringify({ rects, arrows, nextId: _id }));
  tab.historyIdx = tab.history.length - 1;
  if (tab.history.length > 80) { tab.history.shift(); tab.historyIdx--; }
  updateUndoRedoBtns();
}

function applyHistoryState(state) {
  const tab    = currentTab();
  rects        = tab.rects  = state.rects;
  arrows       = tab.arrows = state.arrows;
  _id          = tab.nextId = state.nextId;
  selectedId   = null; selectedType = null;
  render(); updateStatus(); updateUndoRedoBtns();
}

function undo() {
  const tab = currentTab();
  if (tab.historyIdx <= 0) return;
  tab.historyIdx--;
  applyHistoryState(JSON.parse(tab.history[tab.historyIdx]));
  showStatusMsg('Annulé');
}

function redo() {
  const tab = currentTab();
  if (tab.historyIdx >= tab.history.length - 1) return;
  tab.historyIdx++;
  applyHistoryState(JSON.parse(tab.history[tab.historyIdx]));
  showStatusMsg('Refait');
}

function updateUndoRedoBtns() {
  const tab = currentTab();
  const u   = document.getElementById('btn-undo');
  const r   = document.getElementById('btn-redo');
  if (u) u.disabled = tab.historyIdx <= 0;
  if (r) r.disabled = tab.historyIdx >= tab.history.length - 1;
}

// ─── Clipboard (Copy / Paste) ────────────────────────────────

function copySelected() {
  if (selectedType !== 'rect' || !selectedId) return;
  const r = rects.find(r => r.id === selectedId);
  if (!r) return;
  clipboard = JSON.parse(JSON.stringify(r));
  const btn = document.getElementById('btn-paste');
  if (btn) btn.disabled = false;
  showStatusMsg('Copié : «\u00A0' + (r.label || r.id) + '\u00A0»');
}

function pasteClipboard() {
  if (!clipboard) return;
  saveHistory();
  const newR = { ...JSON.parse(JSON.stringify(clipboard)), id: uid(), x: clipboard.x + GRID_STEP, y: clipboard.y + GRID_STEP, parentId: null };
  rects.push(newR);
  selectedId   = newR.id;
  selectedType = 'rect';
  render(); updateStatus();
  showStatusMsg('Collé');
}

// ─── Snap to grid ────────────────────────────────────────────

function snapCoord(v) {
  return snapToGrid ? Math.round(v / GRID_STEP) * GRID_STEP : v;
}

// ─── SADT Validation ─────────────────────────────────────────

function validateSADT() {
  const errors   = [];
  const warnings = [];

  if (rects.length === 0) { warnings.push('Le diagramme est vide (aucune fonction).'); }

  rects.forEach(rect => {
    const lbl       = '"' + (rect.label || rect.id) + '"';
    const inFlux    = arrows.filter(a => a.endRectId === rect.id   && a.arrowType !== 'control' && a.arrowType !== 'mechanism');
    const outFlux   = arrows.filter(a => a.startRectId === rect.id && a.arrowType !== 'control' && a.arrowType !== 'mechanism');
    const ctrls     = arrows.filter(a => a.endRectId === rect.id   && a.arrowType === 'control');
    const connIn    = arrows.filter(a => a.endRectId === rect.id   && a.arrowType === 'connected');

    if (inFlux.length  === 0 && connIn.length === 0) warnings.push('Fonction ' + lbl + ' : aucune entrée.');
    if (outFlux.length === 0 && connIn.length === 0) warnings.push('Fonction ' + lbl + ' : aucune sortie.');
    if (ctrls.length   === 0)                        warnings.push('Fonction ' + lbl + ' : aucun contrôle.');
  });

  if (rects.length > 1) {
    rects.filter(r => !arrows.some(a => a.startRectId === r.id || a.endRectId === r.id))
         .forEach(r => warnings.push('Fonction "' + (r.label || r.id) + '" : non connectée.'));
  }

  const msg = errors.length === 0 && warnings.length === 0
    ? '✅ Diagramme SADT valide !\n\nToutes les règles de cohérence sont respectées.'
    : [
        errors.length   > 0 ? 'Erreurs (' + errors.length + ') :\n'   + errors.map(e   => '❌ ' + e).join('\n') : '',
        warnings.length > 0 ? 'Avertissements (' + warnings.length + ') :\n' + warnings.map(w => '⚠️ ' + w).join('\n') : '',
      ].filter(Boolean).join('\n\n');

  alert(msg);
}

// ─── Status helpers ──────────────────────────────────────────

let _statusTimer = null;
function showStatusMsg(msg) {
  statusHint.textContent = msg;
  clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => {
    if (statusHint.textContent === msg) statusHint.textContent = MODE_HINTS[mode] || '';
  }, STATUS_MSG_DELAY);
}

// ─── Geometry helpers ────────────────────────────────────────

function getAnchorXY(rect, anchor) {
  const { x, y, width: w, height: h } = rect;
  switch (anchor.side) {
    case 'left':   return { x,     y: y + anchor.t * h };
    case 'right':  return { x: x+w, y: y + anchor.t * h };
    case 'top':    return { x: x + anchor.t * w, y };
    case 'bottom': return { x: x + anchor.t * w, y: y+h };
    default:       return { x, y };
  }
}

function getArrowEndpoints(arrow) {
  let x1, y1, x2, y2;
  if (arrow.startRectId) {
    const r = rects.find(r => r.id === arrow.startRectId);
    if (r) {
      const p = getAnchorXY(r, arrow.startAnchor);
      x1 = p.x; y1 = p.y;
    } else {
      x1 = arrow.startX; y1 = arrow.startY;
    }
  } else { x1 = arrow.startX; y1 = arrow.startY; }
  if (arrow.endRectId) {
    const r = rects.find(r => r.id === arrow.endRectId);
    if (r) {
      const p = getAnchorXY(r, arrow.endAnchor);
      x2 = p.x; y2 = p.y;
    } else {
      x2 = arrow.endX; y2 = arrow.endY;
    }
  } else { x2=arrow.endX; y2=arrow.endY; }
  return { x1, y1, x2, y2 };
}

function getArrowPoints(arrow) {
  const { x1, y1, x2, y2 } = getArrowEndpoints(arrow);
  const pts = [{ x: x1, y: y1 }];
  if (arrow.waypoints && arrow.waypoints.length) pts.push(...arrow.waypoints);
  pts.push({ x: x2, y: y2 });
  return pts;
}

function getArrowLabelPos(arrow) {
  const pts = getArrowPoints(arrow);
  if (pts.length < 2) return { x: 0, y: 0 };
  let bestIdx = 0, bestLen = 0;
  const segLens = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
    segLens.push(l);
    if (l > bestLen) { bestLen = l; bestIdx = i; }
  }
  const p0 = pts[bestIdx], p1 = pts[bestIdx+1];
  const mx = (p0.x+p1.x)/2, my = (p0.y+p1.y)/2;
  const dx = p1.x-p0.x, dy = p1.y-p0.y;
  const sl = segLens[bestIdx] || 1;
  return { x: mx + dy/sl*18, y: my + (-dx/sl)*18 };
}

function findSnap(mx, my, excludeId) {
  let best = null, bestD = SNAP_RADIUS;
  for (const rect of rects) {
    if (rect.id === excludeId) continue;
    const { x, y, width: w, height: h } = rect;
    if (my >= y && my <= y+h) {
      let d = Math.abs(mx - x);
      if (d < bestD) { bestD=d; best={ rectId: rect.id, anchor:{ side:'left',  t:(my-y)/h }, x,    y:my }; }
      d = Math.abs(mx - (x+w));
      if (d < bestD) { bestD=d; best={ rectId: rect.id, anchor:{ side:'right', t:(my-y)/h }, x:x+w,y:my }; }
    }
    if (mx >= x && mx <= x+w) {
      let d = Math.abs(my - y);
      if (d < bestD) { bestD=d; best={ rectId: rect.id, anchor:{ side:'top',    t:(mx-x)/w }, x:mx, y    }; }
      d = Math.abs(my - (y+h));
      if (d < bestD) { bestD=d; best={ rectId: rect.id, anchor:{ side:'bottom', t:(mx-x)/w }, x:mx, y:y+h}; }
    }
  }
  return best;
}

function ptSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2-x1, dy = y2-y1;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px-x1, py-y1);
  const t = Math.max(0, Math.min(1, ((px-x1)*dx + (py-y1)*dy) / lenSq));
  return Math.hypot(px - (x1+t*dx), py - (y1+t*dy));
}

function rectHandles(rect) {
  const { x, y, width: w, height: h } = rect;
  return [
    { handle: 'nw', x,     y     },
    { handle: 'ne', x: x+w,y     },
    { handle: 'se', x: x+w,y:y+h },
    { handle: 'sw', x,     y:y+h },
  ];
}

// ─── Hit testing ─────────────────────────────────────────────

function hitRect(mx, my) {
  const order = getRenderOrder();
  for (let i = order.length - 1; i >= 0; i--) {
    const r = order[i];
    if (mx >= r.x && mx <= r.x+r.width && my >= r.y && my <= r.y+r.height) return r.id;
  }
  return null;
}

function hitArrow(mx, my) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i], pts = getArrowPoints(a);
    for (let j = 0; j < pts.length - 1; j++)
      if (ptSegDist(mx, my, pts[j].x, pts[j].y, pts[j+1].x, pts[j+1].y) < 6) return a.id;
  }
  return null;
}

function hitWaypoint(mx, my, arrow) {
  const wps = arrow.waypoints || [];
  for (let i = 0; i < wps.length; i++)
    if (Math.hypot(mx-wps[i].x, my-wps[i].y) < 8) return i;
  return -1;
}

function hitArrowLabel(mx, my) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (!a.label) continue;
    const { x, y } = getArrowLabelPos(a);
    if (Math.hypot(mx-x, my-y) < 20) return a.id;
  }
  return null;
}

function hitHandle(mx, my, rect) {
  const half = HANDLE_SIZE / 2 + 2;
  for (const h of rectHandles(rect))
    if (Math.abs(mx-h.x) <= half && Math.abs(my-h.y) <= half) return h.handle;
  return null;
}

// ─── Rendering ───────────────────────────────────────────────

function drawGrid() {
  if (!showGrid) return;
  ctx.save();
  ctx.strokeStyle = '#d8e0e8';
  ctx.lineWidth   = 0.5 / viewScale;
  // Compute the visible world area
  const worldLeft   = -viewOffsetX / viewScale;
  const worldTop    = -viewOffsetY / viewScale;
  const worldRight  = (canvasEl.width  - viewOffsetX) / viewScale;
  const worldBottom = (canvasEl.height - viewOffsetY) / viewScale;
  const startX = Math.floor(worldLeft  / GRID_STEP) * GRID_STEP;
  const startY = Math.floor(worldTop   / GRID_STEP) * GRID_STEP;
  for (let x = startX; x <= worldRight;  x += GRID_STEP) {
    ctx.beginPath(); ctx.moveTo(x, worldTop); ctx.lineTo(x, worldBottom); ctx.stroke();
  }
  for (let y = startY; y <= worldBottom; y += GRID_STEP) {
    ctx.beginPath(); ctx.moveTo(worldLeft, y); ctx.lineTo(worldRight, y); ctx.stroke();
  }
  ctx.restore();
}

function drawArrowHead(x, y, angle) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ARROW_HEAD_LEN * Math.cos(angle - ARROW_HEAD_ANG), y - ARROW_HEAD_LEN * Math.sin(angle - ARROW_HEAD_ANG));
  ctx.lineTo(x - ARROW_HEAD_LEN * Math.cos(angle + ARROW_HEAD_ANG), y - ARROW_HEAD_LEN * Math.sin(angle + ARROW_HEAD_ANG));
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function wrapText(text, maxWidth) {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else { line = test; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawRect(rect, selected) {
  ctx.save();
  const { x, y, width: w, height: h, label } = rect;
  const isParent = rects.some(r => r.parentId === rect.id);

  ctx.shadowColor   = selected ? '#3b82f6' : 'rgba(0,0,0,0.18)';
  ctx.shadowBlur    = selected ? 12 : 5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = selected ? 0 : 2;

  ctx.fillStyle   = isParent ? '#eef6ff' : '#ffffff';
  ctx.strokeStyle = selected ? (isParent ? '#1d4ed8' : '#2563eb') : (isParent ? '#1e40af' : '#374151');
  ctx.lineWidth   = selected ? (isParent ? 3 : 2.5) : (isParent ? 2 : 1.5);

  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, 4); } else { ctx.rect(x, y, w, h); }
  ctx.fill(); ctx.stroke();

  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  if (isParent) {
    ctx.strokeStyle = selected ? '#1d4ed8' : '#93c5fd';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x+2, y+PARENT_LABEL_H); ctx.lineTo(x+w-2, y+PARENT_LABEL_H); ctx.stroke();
  }

  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if (isParent) {
    ctx.fillText(label || 'Fonction', x+w/2, y+PARENT_LABEL_H/2, w-12);
  } else {
    const lines = wrapText(label || 'Fonction', w-16);
    const lh = 18;
    let lineY = y + h/2 - (lines.length * lh)/2 + lh/2;
    for (const ln of lines) { ctx.fillText(ln, x+w/2, lineY, w-12); lineY += lh; }
  }

  if (selected) {
    ctx.fillStyle = '#2563eb'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    for (const h of rectHandles(rect)) {
      ctx.beginPath(); ctx.rect(h.x-HANDLE_SIZE/2, h.y-HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawArrow(arrow, selected) {
  const pts   = getArrowPoints(arrow);
  const color = ARROW_COLORS[arrow.arrowType] || ARROW_COLORS.connected;

  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth   = selected ? 3 : 2.5;
  if (selected) { ctx.shadowColor = color; ctx.shadowBlur = 6; }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const last = pts[pts.length-1], prev = pts[pts.length-2];
  drawArrowHead(last.x, last.y, Math.atan2(last.y-prev.y, last.x-prev.x));

  if (selected && arrow.waypoints && arrow.waypoints.length > 0) {
    ctx.lineWidth = 1.5; ctx.strokeStyle = color;
    for (const wp of arrow.waypoints) {
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(wp.x, wp.y, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }
  }

  if (arrow.label) {
    const { x: lx, y: ly } = getArrowLabelPos(arrow);
    ctx.font = 'bold 13px Arial, sans-serif';
    const tw  = ctx.measureText(arrow.label).width, pad = 5;
    ctx.fillStyle   = 'rgba(255,255,255,0.97)';
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(lx-tw/2-pad, ly-10, tw+pad*2, 20, 3); }
    else               { ctx.rect(lx-tw/2-pad, ly-10, tw+pad*2, 20); }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(arrow.label, lx, ly);
  }
  ctx.restore();
}

function getRenderOrder() {
  const result = [], visited = new Set();
  function visit(r) {
    if (visited.has(r.id)) return;
    visited.add(r.id); result.push(r);
    rects.forEach(child => { if (child.parentId === r.id) visit(child); });
  }
  rects.forEach(r => { if (!r.parentId || !rects.find(p => p.id === r.parentId)) visit(r); });
  rects.forEach(r => visit(r));
  return result;
}

function render() {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = '#f0f4f8';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

  ctx.save();
  ctx.setTransform(viewScale, 0, 0, viewScale, viewOffsetX, viewOffsetY);

  drawGrid();

  getRenderOrder().forEach(r => drawRect(r, selectedType === 'rect' && r.id === selectedId));
  arrows.forEach(a => drawArrow(a, selectedType === 'arrow' && a.id === selectedId));

  if (arrowDraw) {
    const { startX: sx, startY: sy, curX: cx, curY: cy } = arrowDraw;
    const color = mode === 'add-arrow' ? ARROW_COLORS.connected : (ARROW_COLORS[freeArrowType] || '#555');
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.setLineDash([]);
    drawArrowHead(cx, cy, Math.atan2(cy-sy, cx-sx));
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fill();
    const snap = findSnap(cx, cy, arrowDraw.startRectId);
    if (snap) {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(snap.x, snap.y, 7, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

// ─── Canvas sizing ───────────────────────────────────────────

function resizeCanvas() {
  canvasEl.width  = container.clientWidth;
  canvasEl.height = container.clientHeight;
  render();
}

// ─── Cursor ──────────────────────────────────────────────────

function updateCursor(mx, my) {
  if (mode !== 'select') { canvasEl.style.cursor = 'crosshair'; return; }
  if (selectedType === 'rect') {
    const sr = rects.find(r => r.id === selectedId);
    if (sr) {
      const h = hitHandle(mx, my, sr);
      if (h) { canvasEl.style.cursor = { nw:'nw-resize', ne:'ne-resize', se:'se-resize', sw:'sw-resize' }[h]; return; }
    }
  }
  if (selectedType === 'arrow') {
    const sa = arrows.find(a => a.id === selectedId);
    if (sa && hitWaypoint(mx, my, sa) >= 0) { canvasEl.style.cursor = 'grab'; return; }
  }
  if (hitRect(mx, my))  { canvasEl.style.cursor = 'grab';    return; }
  if (hitArrow(mx, my)) { canvasEl.style.cursor = 'pointer'; return; }
  canvasEl.style.cursor = 'default';
}

// ─── Status bar ──────────────────────────────────────────────

function updateStatus() {
  const btnRename     = document.getElementById('btn-rename');
  const btnActi       = document.getElementById('btn-open-actigramme');
  const btnCopy       = document.getElementById('btn-copy');

  if (!selectedId) {
    statusSel.textContent = '';
    if (btnRename) btnRename.disabled = true;
    if (btnActi)   btnActi.disabled   = true;
    if (btnCopy)   btnCopy.disabled   = true;
    return;
  }
  if (btnRename) btnRename.disabled = false;
  if (selectedType === 'rect') {
    const r = rects.find(r => r.id === selectedId);
    statusSel.textContent = r ? 'Fonction\u00A0: «\u00A0' + (r.label || r.id) + '\u00A0»' : '';
    if (btnActi) btnActi.disabled = false;
    if (btnCopy) btnCopy.disabled = false;
  } else {
    const a = arrows.find(a => a.id === selectedId);
    if (a) statusSel.textContent = 'Flèche (' + (TYPE_LABELS[a.arrowType] || a.arrowType) + ')' + (a.label ? ' : «\u00A0' + a.label + '\u00A0»' : '');
    if (btnActi) btnActi.disabled = true;
    if (btnCopy) btnCopy.disabled = true;
  }
}

// ─── Mode management ─────────────────────────────────────────

function setMode(newMode) {
  mode = newMode; arrowDraw = null;
  document.querySelectorAll('.r-btn[data-mode]').forEach(b => b.classList.remove('active'));
  const ids = { select:'btn-select', 'add-rect':'btn-add-rect', 'add-arrow':'btn-add-arrow', 'add-free-arrow':'btn-add-free-arrow' };
  if (ids[newMode]) { const b = document.getElementById(ids[newMode]); if (b) b.classList.add('active'); }
  const names = { select:'Sélection', 'add-rect':'Ajouter une fonction', 'add-arrow':'Connexion', 'add-free-arrow':'Flèche SADT libre' };
  statusMode.textContent = 'Mode\u00A0: ' + (names[newMode] || newMode);
  statusHint.textContent = MODE_HINTS[newMode] || '';
  render();
}

// ─── Actions ─────────────────────────────────────────────────

function addRect(x, y) {
  saveHistory();
  const rect = {
    id: uid(),
    x:  snapCoord(x - RECT_W_DEFAULT / 2),
    y:  snapCoord(y - RECT_H_DEFAULT / 2),
    width: RECT_W_DEFAULT, height: RECT_H_DEFAULT,
    label: 'Fonction', parentId: null,
  };
  rects.push(rect);
  selectedId = rect.id; selectedType = 'rect';
  render(); updateStatus();
}

function finishArrow(endX, endY, snap) {
  arrows.push({
    id: uid(), label: '',
    arrowType:   mode === 'add-arrow' ? 'connected' : freeArrowType,
    waypoints:   [],
    startRectId: arrowDraw.startRectId || null,
    startAnchor: arrowDraw.startAnchor || null,
    startX: arrowDraw.startX, startY: arrowDraw.startY,
    endRectId: snap ? snap.rectId : null,
    endAnchor: snap ? snap.anchor : null,
    endX: snap ? snap.x : endX, endY: snap ? snap.y : endY,
  });
  arrowDraw    = null;
  selectedId   = arrows[arrows.length-1].id;
  selectedType = 'arrow';
  render(); updateStatus();
  showStatusMsg('Flèche créée — Double-clic pour l\'étiqueter.');
}

function deleteSelected() {
  if (!selectedId) return;
  saveHistory();
  if (selectedType === 'rect') {
    rects.forEach(r => { if (r.parentId === selectedId) r.parentId = null; });
    rects  = rects.filter(r => r.id !== selectedId);
    arrows = arrows.filter(a => a.startRectId !== selectedId && a.endRectId !== selectedId);
    const tab = currentTab(); tab.rects = rects; tab.arrows = arrows;
  } else {
    arrows = arrows.filter(a => a.id !== selectedId);
    currentTab().arrows = arrows;
  }
  selectedId = null; selectedType = null;
  render(); updateStatus();
}

// ─── Fit-to-view ─────────────────────────────────────────────

function fitToView() {
  if (rects.length === 0 && arrows.length === 0) return;
  // Reset viewport so coordinates are normalised in screen space
  viewScale = 1; viewOffsetX = 0; viewOffsetY = 0;
  const PAD = 60;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  rects.forEach(r => { minX=Math.min(minX,r.x); minY=Math.min(minY,r.y); maxX=Math.max(maxX,r.x+r.width); maxY=Math.max(maxY,r.y+r.height); });
  arrows.forEach(a => getArrowPoints(a).forEach(p => { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }));
  if (!isFinite(minX)) return;
  const cw=maxX-minX||1, ch=maxY-minY||1, W=canvasEl.width, H=canvasEl.height;
  const scale = Math.min((W-2*PAD)/cw, (H-2*PAD)/ch, 1);
  const tx = PAD + (W-2*PAD-cw*scale)/2 - minX*scale;
  const ty = PAD + (H-2*PAD-ch*scale)/2 - minY*scale;
  rects.forEach(r => { r.x=Math.round(r.x*scale+tx); r.y=Math.round(r.y*scale+ty); r.width=Math.round(r.width*scale); r.height=Math.round(r.height*scale); });
  arrows.forEach(a => {
    a.startX=Math.round(a.startX*scale+tx); a.startY=Math.round(a.startY*scale+ty);
    a.endX=Math.round(a.endX*scale+tx);     a.endY=Math.round(a.endY*scale+ty);
    if (a.waypoints) a.waypoints = a.waypoints.map(wp => ({ x:Math.round(wp.x*scale+tx), y:Math.round(wp.y*scale+ty) }));
  });
  selectedId=null; selectedType=null; updateZoomDisplay(); render(); updateStatus();
}

// ─── Zoom helpers ─────────────────────────────────────────────

function updateZoomDisplay() {
  const el = document.getElementById('nav-zoom');
  if (el) el.textContent = Math.round(viewScale * 100) + '%';
}

function zoomAt(screenX, screenY, factor) {
  const newScale = Math.min(Math.max(viewScale * factor, ZOOM_MIN), ZOOM_MAX);
  if (newScale === viewScale) return;
  viewOffsetX = screenX - (screenX - viewOffsetX) * (newScale / viewScale);
  viewOffsetY = screenY - (screenY - viewOffsetY) * (newScale / viewScale);
  viewScale   = newScale;
  updateZoomDisplay();
  render();
}

function resetZoom() {
  viewScale   = 1.0;
  viewOffsetX = 0;
  viewOffsetY = 0;
  updateZoomDisplay();
  render();
}

// ─── Auto Layout ─────────────────────────────────────────────

function computeOrthogonalWaypoints(x1, y1, side1, x2, y2, side2) {
  if (Math.abs(x1-x2)<2 && Math.abs(y1-y2)<2) return [];
  const hS = new Set(['left','right']), vS = new Set(['top','bottom']);
  if (hS.has(side1) && hS.has(side2)) {
    const midX = Math.round((x1 + x2) / 2);
    if (Math.abs(y1 - y2) < 2) return [];
    return [{ x: midX, y: y1 }, { x: midX, y: y2 }];
  }
  if (vS.has(side1) && vS.has(side2)) {
    const midY = Math.round((y1 + y2) / 2);
    if (Math.abs(x1 - x2) < 2) return [];
    return [{ x: x1, y: midY }, { x: x2, y: midY }];
  }
  if (hS.has(side1) && vS.has(side2)) return [{x:x2,y:y1}];
  if (vS.has(side1) && hS.has(side2)) return [{x:x1,y:y2}];
  if (hS.has(side1) && !side2) { if(Math.abs(y1-y2)<2)return[]; return[{x:x2,y:y1}]; }
  if (vS.has(side1) && !side2) { if(Math.abs(x1-x2)<2)return[]; return[{x:x1,y:y2}]; }
  if (!side1 && hS.has(side2)) { if(Math.abs(y1-y2)<2)return[]; return[{x:x1,y:y2}]; }
  if (!side1 && vS.has(side2)) { if(Math.abs(x1-x2)<2)return[]; return[{x:x2,y:y1}]; }
  return [];
}

function routeArrowsOrthogonal() {
  arrows.forEach(a => {
    if (a.startAnchor) a.startAnchor = { side: a.startAnchor.side, t: 0.5 };
    if (a.endAnchor)   a.endAnchor   = { side: a.endAnchor.side,   t: 0.5 };
  });
  const sideMap = new Map();
  arrows.forEach(a => {
    if (a.startRectId && a.startAnchor) {
      const k = a.startRectId+':'+a.startAnchor.side;
      if (!sideMap.has(k)) sideMap.set(k, []);
      sideMap.get(k).push({ arrow: a, role: 'start' });
    }
    if (a.endRectId && a.endAnchor) {
      const k = a.endRectId+':'+a.endAnchor.side;
      if (!sideMap.has(k)) sideMap.set(k, []);
      sideMap.get(k).push({ arrow: a, role: 'end' });
    }
  });
  sideMap.forEach(entries => {
    const count = entries.length;
    entries.forEach((entry, i) => {
      const t = (i+1)/(count+1);
      if (entry.role==='start') entry.arrow.startAnchor = { side: entry.arrow.startAnchor.side, t };
      else                      entry.arrow.endAnchor   = { side: entry.arrow.endAnchor.side,   t };
    });
  });
  arrows.forEach(a => {
    const ep = getArrowEndpoints(a);
    const s1 = a.startAnchor ? a.startAnchor.side : null;
    const s2 = a.endAnchor   ? a.endAnchor.side   : null;
    const wps = computeOrthogonalWaypoints(ep.x1, ep.y1, s1, ep.x2, ep.y2, s2);
    a.waypoints = avoidRectObstacles(wps, ep.x1, ep.y1, ep.x2, ep.y2, a.startRectId, a.endRectId);
  });
}

function segmentIntersectsRect(px, py, qx, qy, r) {
  const minX=r.x, maxX=r.x+r.width, minY=r.y, maxY=r.y+r.height;
  if (Math.abs(py - qy) < COORD_EPSILON) {
    if (py <= minY || py >= maxY) return false;
    const lo = Math.min(px, qx), hi = Math.max(px, qx);
    return lo < maxX && hi > minX;
  }
  if (Math.abs(px - qx) < COORD_EPSILON) {
    if (px <= minX || px >= maxX) return false;
    const lo = Math.min(py, qy), hi = Math.max(py, qy);
    return lo < maxY && hi > minY;
  }
  const dx=qx-px, dy=qy-py;
  let tMin=0, tMax=1;
  for (const [p2, q2] of [[-dx,px-minX],[dx,maxX-px],[-dy,py-minY],[dy,maxY-py]]) {
    if (p2===0) { if(q2<0)return false; } else { const t=q2/p2; if(p2<0)tMin=Math.max(tMin,t); else tMax=Math.min(tMax,t); }
    if (tMin>tMax) return false;
  }
  return true;
}

function avoidRectObstacles(waypoints, x1, y1, x2, y2, startRectId, endRectId) {
  const margin    = CHILD_PADDING;
  let   pts       = [{ x:x1, y:y1 }, ...waypoints, { x:x2, y:y2 }];
  const obstacles = rects.filter(r => r.id !== startRectId && r.id !== endRectId);
  if (obstacles.length === 0) return waypoints;
  let changed = true, iterations = 0;
  while (changed && iterations < MAX_OBSTACLE_ITER) {
    changed = false; iterations++;
    const newPts = [pts[0]];
    for (let i = 0; i < pts.length-1; i++) {
      const p = pts[i], q = pts[i+1];
      let blocked = obstacles.find(r => segmentIntersectsRect(p.x,p.y,q.x,q.y,r)) || null;
      if (!blocked) { newPts.push(q); continue; }
      changed = true;
      const rL=blocked.x-margin, rR=blocked.x+blocked.width+margin, rT=blocked.y-margin, rB=blocked.y+blocked.height+margin;
      if (Math.abs(p.y-q.y)<COORD_EPSILON) { const dY=(Math.abs(p.y-rT)<Math.abs(p.y-rB))?rT:rB; newPts.push({x:p.x,y:dY}); newPts.push({x:q.x,y:dY}); newPts.push(q); }
      else if (Math.abs(p.x-q.x)<COORD_EPSILON) { const dX=(Math.abs(p.x-rL)<Math.abs(p.x-rR))?rL:rR; newPts.push({x:dX,y:p.y}); newPts.push({x:dX,y:q.y}); newPts.push(q); }
      else { newPts.push(q); }
    }
    pts = newPts;
  }
  return pts.slice(1, pts.length-1);
}

function autoLayout() {
  if (rects.length === 0 && arrows.length === 0) return;
  const isTopLevel = r => !r.parentId || !rects.find(p => p.id === r.parentId);
  const topLevel   = rects.filter(isTopLevel);

  function autoSizeRect(rect) {
    const savedF = ctx.font; ctx.font = 'bold 14px Arial, sans-serif';
    const lbl    = rect.label || 'Fonction';
    const H_PAD=16, V_PAD=12, LINE_H=18;
    const mW     = Math.max(rect.width-2*H_PAD, RECT_W_DEFAULT-2*H_PAD);
    const lines  = wrapText(lbl, mW);
    const maxW   = lines.length ? Math.max(...lines.map(l => ctx.measureText(l).width)) : 0;
    ctx.font = savedF;
    rect.width  = Math.max(rect.width,  maxW+2*H_PAD,   RECT_W_DEFAULT);
    rect.height = Math.max(rect.height, lines.length*LINE_H+2*V_PAD, RECT_H_DEFAULT);
  }

  function childrenOverlap(children) {
    const m = CHILD_PADDING/2;
    for (let i=0;i<children.length;i++) for (let j=i+1;j<children.length;j++) {
      const a=children[i], b=children[j];
      if(a.x-m<b.x+b.width+m&&a.x+a.width+m>b.x-m&&a.y-m<b.y+b.height+m&&a.y+a.height+m>b.y-m) return true;
    }
    return false;
  }

  function redistributeChildren(parent, children) {
    const cols = children.length<=2?1:children.length<=4?2:3;
    let curX=parent.x+CHILD_PADDING, curY=parent.y+PARENT_LABEL_H+CHILD_PADDING, col=0, rowH=0;
    children.forEach(child => {
      const dx=curX-child.x, dy=curY-child.y; child.x=curX; child.y=curY; moveChildren(child.id,dx,dy);
      rowH=Math.max(rowH,child.height); col++;
      if(col===cols){curX=parent.x+CHILD_PADDING;curY+=rowH+CHILD_PADDING;rowH=0;col=0;}
      else{curX+=child.width+CHILD_PADDING;}
    });
  }

  function computeSize(rect) {
    const children = rects.filter(r => r.parentId === rect.id);
    if (!children.length) { autoSizeRect(rect); return; }
    children.forEach(computeSize);
    if (childrenOverlap(children) || children.some(c => c.y < rect.y+PARENT_LABEL_H+CHILD_PADDING)) redistributeChildren(rect, children);
    const relR = Math.max(...children.map(c => (c.x-rect.x)+c.width));
    const relB = Math.max(...children.map(c => (c.y-rect.y)+c.height));
    const minH = PARENT_LABEL_H+CHILD_PADDING+Math.max(...children.map(c=>c.height))+CHILD_PADDING;
    rect.width  = Math.max(rect.width,  relR+CHILD_PADDING);
    rect.height = Math.max(rect.height, relB+CHILD_PADDING, minH);
  }

  topLevel.forEach(computeSize);

  let bBMinX=Infinity, bBMinY=Infinity;
  rects.forEach(r => { if(r.x<bBMinX)bBMinX=r.x; if(r.y<bBMinY)bBMinY=r.y; });
  if(!isFinite(bBMinX))bBMinX=0; if(!isFinite(bBMinY))bBMinY=0;

  const cols2=topLevel.length<=6?topLevel.length:Math.max(1,Math.ceil(Math.sqrt(topLevel.length)));
  let rowX=LAYOUT_PADDING, rowY=LAYOUT_PADDING, maxRowH=0, colIdx=0;
  topLevel.forEach(r => {
    if(colIdx===cols2){rowY+=maxRowH+LAYOUT_V_SPACING;rowX=LAYOUT_PADDING;maxRowH=0;colIdx=0;}
    const dx=rowX-r.x, dy=rowY-r.y; r.x=rowX; r.y=rowY; moveChildren(r.id,dx,dy);
    rowX+=r.width+LAYOUT_H_SPACING; maxRowH=Math.max(maxRowH,r.height); colIdx++;
  });

  let bAMinX=Infinity, bAMinY=Infinity;
  rects.forEach(r => { if(r.x<bAMinX)bAMinX=r.x; if(r.y<bAMinY)bAMinY=r.y; });
  if(!isFinite(bAMinX))bAMinX=0; if(!isFinite(bAMinY))bAMinY=0;

  const gdx=bAMinX-bBMinX, gdy=bAMinY-bBMinY;
  arrows.forEach(a => {
    if(!a.startRectId){a.startX+=gdx;a.startY+=gdy;}
    if(!a.endRectId)  {a.endX+=gdx;  a.endY+=gdy;}
  });

  routeArrowsOrthogonal();
  selectedId=null; selectedType=null;
  fitToView();
}

function finishSADT() {
  if (!confirm('Aligner automatiquement le diagramme SADT ?\n\n• Fonctions en grille\n• Sous-fonctions conservent leur position relative\n• Flèches en angles droits\n• Vue ajustée')) return;
  autoLayout();
  showStatusMsg('✅ Diagramme aligné !');
}

function alignArrowsOnly() {
  if (!arrows.length) return;
  routeArrowsOrthogonal(); render();
  showStatusMsg('✅ Flèches alignées en angles droits !');
}

// ─── Nested-rectangle helpers ────────────────────────────────

function getDescendants(id) {
  const result = new Set(), queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    rects.forEach(r => { if (r.parentId === cur) { result.add(r.id); queue.push(r.id); } });
  }
  return result;
}

function moveChildren(parentId, dx, dy) {
  rects.forEach(r => { if (r.parentId === parentId) { r.x+=dx; r.y+=dy; moveChildren(r.id,dx,dy); } });
}

function expandParentForChild(parent, child) {
  const reqL=child.x-CHILD_PADDING, reqT=child.y-PARENT_LABEL_H-CHILD_PADDING;
  const reqR=child.x+child.width+CHILD_PADDING, reqB=child.y+child.height+CHILD_PADDING;
  let changed=false;
  if(reqL<parent.x)               {const d=parent.x-reqL;parent.x-=d;parent.width+=d;changed=true;}
  if(reqT<parent.y)               {const d=parent.y-reqT;parent.y-=d;parent.height+=d;changed=true;}
  if(reqR>parent.x+parent.width)  {parent.width=reqR-parent.x;changed=true;}
  if(reqB>parent.y+parent.height) {parent.height=reqB-parent.y;changed=true;}
  if(changed && parent.parentId) { const gp=rects.find(r=>r.id===parent.parentId); if(gp)expandParentForChild(gp,parent); }
}

function addSubRect(parentId) {
  const parent = rects.find(r => r.id === parentId);
  if (!parent) return;
  const minW=RECT_W_DEFAULT+2*CHILD_PADDING, minH=RECT_H_DEFAULT+PARENT_LABEL_H+2*CHILD_PADDING;
  if(parent.width<minW)parent.width=minW; if(parent.height<minH)parent.height=minH;
  const iTop=parent.y+PARENT_LABEL_H+CHILD_PADDING;
  const aH=parent.height-PARENT_LABEL_H-2*CHILD_PADDING-RECT_H_DEFAULT;
  const aW=parent.width-2*CHILD_PADDING-RECT_W_DEFAULT;
  saveHistory();
  const rect={id:uid(),x:parent.x+CHILD_PADDING+Math.max(0,aW)/2,y:iTop+Math.max(0,aH)/2,width:RECT_W_DEFAULT,height:RECT_H_DEFAULT,label:'Sous-fonction',parentId};
  rects.push(rect); selectedId=rect.id; selectedType='rect';
  render(); updateStatus();
}

// ─── Drag & Resize ───────────────────────────────────────────

function doDrag(mx, my) {
  if (!dragInfo) return;
  const r = rects.find(r => r.id === dragInfo.id);
  if (!r) return;
  const newX=snapCoord(mx-dragInfo.ox), newY=snapCoord(my-dragInfo.oy);
  const dx=newX-r.x, dy=newY-r.y;
  r.x=newX; r.y=newY; moveChildren(r.id,dx,dy);
  if(r.parentId){const p=rects.find(p=>p.id===r.parentId);if(p)expandParentForChild(p,r);}
}

function doResize(mx, my) {
  if (!resizeInfo) return;
  const r=rects.find(r=>r.id===resizeInfo.id); if(!r)return;
  const {orig,handle,mx0,my0}=resizeInfo, dx=mx-mx0, dy=my-my0;
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
      r.y      = orig.y + orig.height - nh;
      r.width  = Math.max(RECT_MIN_W, orig.width + dx);
      r.height = nh;
      break;
    }
    case 'se':
      r.width  = Math.max(RECT_MIN_W, orig.width  + dx);
      r.height = Math.max(RECT_MIN_H, orig.height + dy);
      break;
    case 'sw': {
      const nw = Math.max(RECT_MIN_W, orig.width - dx);
      r.x      = orig.x + orig.width - nw;
      r.width  = nw;
      r.height = Math.max(RECT_MIN_H, orig.height + dy);
      break;
    }
    default: break;
  }
}

// ─── Inline text editing ─────────────────────────────────────

function startEditRect(id) {
  const r=rects.find(r=>r.id===id); if(!r)return;
  editId=id; editType='rect'; labelInput.value=r.label||'';
  positionEditor(r.x, r.y+r.height/2-14, r.width, 28);
  labelEditor.style.display='block'; labelInput.focus(); labelInput.select();
}

function startEditArrow(id) {
  const a=arrows.find(a=>a.id===id); if(!a)return;
  editId=id; editType='arrow'; labelInput.value=a.label||'';
  const {x:lx,y:ly}=getArrowLabelPos(a);
  positionEditor(lx-70, ly-14, 140, 28);
  labelEditor.style.display='block'; labelInput.focus(); labelInput.select();
}

function renameSelected() {
  if (!selectedId) return;
  if (selectedType==='rect')  startEditRect(selectedId);
  else if (selectedType==='arrow') startEditArrow(selectedId);
}

function positionEditor(x, y, w, h) {
  Object.assign(labelEditor.style, { left:x+'px', top:y+'px', width:w+'px', height:h+'px' });
}

function finishEditing() {
  if (!editId) return;
  const val=labelInput.value.trim();
  if (editType==='rect') {
    const r=rects.find(r=>r.id===editId); if(r){saveHistory();r.label=val;}
  } else {
    const a=arrows.find(a=>a.id===editId); if(a){saveHistory();a.label=val;}
  }
  editId=null; editType=null; labelEditor.style.display='none';
  render(); updateStatus();
}

function cancelEditing() {
  editId=null; editType=null; labelEditor.style.display='none';
}

// ─── Save / Load / Export ────────────────────────────────────

function newDiagram() {
  if ((rects.length>0||arrows.length>0) && !confirm('Créer un nouveau diagramme dans un nouvel onglet ?')) return;
  addNewTab('Nouveau diagramme', 'actigramme');
  showStatusMsg('Nouveau diagramme créé dans un nouvel onglet.');
}

function saveJSON() {
  const tab=currentTab();
  const data=JSON.stringify({rects,arrows,nextId:_id,tabLabel:tab.label,tabType:tab.type},null,2);
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='sadt-diagram.json'; a.click();
  URL.revokeObjectURL(url);
}

function loadJSON(file) {
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      const allNums=[...(data.rects||[]),...(data.arrows||[])].map(o=>parseInt(o.id.replace(/^\D+/,''),10)).filter(n=>!isNaN(n));
      const maxId=allNums.length?Math.max(...allNums):0;
      if(maxId+1>_id)_id=maxId+1; if(data.nextId&&data.nextId>_id)_id=data.nextId;
      const label=data.tabLabel||file.name.replace(/\.json$/i,'')||'Diagramme';
      const newTab=createTab(label, data.tabType||'actigramme', null);
      newTab.rects=data.rects||[]; newTab.arrows=data.arrows||[]; newTab.nextId=_id;
      tabs.push(newTab); switchToTab(newTab.id);
      showStatusMsg('✅ Diagramme chargé\u00A0: '+label);
    } catch(err) { alert('Erreur lors du chargement\u00A0: '+err.message); }
  };
  reader.readAsText(file);
}

function exportPNG() {
  const prevId=selectedId, prevType=selectedType;
  selectedId=null; selectedType=null; render();
  const a=document.createElement('a');
  a.href=canvasEl.toDataURL('image/png'); a.download='sadt-diagram.png'; a.click();
  selectedId=prevId; selectedType=prevType; render();
}

// ─── Mouse helpers ───────────────────────────────────────────

function getPos(e) {
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left  - viewOffsetX) / viewScale,
    y: (e.clientY - rect.top   - viewOffsetY) / viewScale,
  };
}

// ─── Mouse events ────────────────────────────────────────────

canvasEl.addEventListener('wheel', e => {
  e.preventDefault();
  const cr  = canvasEl.getBoundingClientRect();
  const sx  = e.clientX - cr.left;
  const sy  = e.clientY - cr.top;
  const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  zoomAt(sx, sy, factor);
}, { passive: false });

canvasEl.addEventListener('mousedown', e => {
  // Middle-mouse button: start panning
  if (e.button === 1) {
    isPanning  = true;
    panStartX  = e.clientX; panStartY  = e.clientY;
    panStartOX = viewOffsetX; panStartOY = viewOffsetY;
    e.preventDefault();
    return;
  }
  if (e.button!==0) return;
  if (editId) finishEditing();
  const {x,y}=getPos(e); mdX=x; mdY=y; moved=false;

  if (mode==='select') {
    if (selectedType==='rect') {
      const sr=rects.find(r=>r.id===selectedId);
      if (sr) { const h=hitHandle(x,y,sr); if(h){isResizing=true;resizeInfo={id:sr.id,handle:h,mx0:x,my0:y,orig:{...sr}};return;} }
    }
    if (selectedType==='arrow') {
      const sa=arrows.find(a=>a.id===selectedId);
      if (sa) { const wi=hitWaypoint(x,y,sa); if(wi>=0){waypointDrag={arrowId:sa.id,wpIdx:wi};return;} }
    }
    const aId=hitArrow(x,y);
    if (aId) { selectedId=aId; selectedType='arrow'; render(); updateStatus(); return; }
    const rId=hitRect(x,y);
    if (rId) {
      const r=rects.find(r=>r.id===rId);
      selectedId=rId; selectedType='rect'; isDragging=true; dragInfo={id:rId,ox:x-r.x,oy:y-r.y};
      render(); updateStatus(); return;
    }
    selectedId=null; selectedType=null; render(); updateStatus(); return;
  }

  if (mode==='add-rect') { addRect(x,y); setMode('select'); return; }

  if (mode==='add-arrow'||mode==='add-free-arrow') {
    if (!arrowDraw) {
      const snap=findSnap(x,y);
      arrowDraw=snap?{startX:snap.x,startY:snap.y,startRectId:snap.rectId,startAnchor:snap.anchor,curX:snap.x,curY:snap.y}
                    :{startX:x,startY:y,startRectId:null,startAnchor:null,curX:x,curY:y};
      render();
    } else {
      const snap=findSnap(x,y,arrowDraw.startRectId);
      saveHistory(); finishArrow(x,y,snap);
    }
  }
});

canvasEl.addEventListener('mousemove', e => {
  // Middle-mouse panning
  if (isPanning) {
    viewOffsetX = panStartOX + (e.clientX - panStartX);
    viewOffsetY = panStartOY + (e.clientY - panStartY);
    render();
    return;
  }

  const {x,y}=getPos(e);
  if(Math.abs(x-mdX)>3||Math.abs(y-mdY)>3) moved=true;

  document.getElementById('nav-coords').textContent='x '+Math.round(x)+', y '+Math.round(y);

  if(isResizing&&resizeInfo){doResize(x,y);render();return;}
  if(isDragging&&dragInfo)  {doDrag(x,y);  render();return;}

  if(waypointDrag){
    const a=arrows.find(a=>a.id===waypointDrag.arrowId);
    if(a&&a.waypoints){a.waypoints[waypointDrag.wpIdx]={x,y};render();}
    return;
  }
  if(arrowDraw){
    const snap=findSnap(x,y,arrowDraw.startRectId);
    arrowDraw.curX=snap?snap.x:x; arrowDraw.curY=snap?snap.y:y; render();
  }
  updateCursor(x,y);
});

canvasEl.addEventListener('mouseup', e => {
  if (e.button === 1) { isPanning = false; return; }
  if(e.button!==0) return;
  if(isDragging&&dragInfo&&moved){
    const dragged=rects.find(r=>r.id===dragInfo.id);
    if(dragged){
      const cx=dragged.x+dragged.width/2, cy=dragged.y+dragged.height/2;
      const desc=getDescendants(dragged.id);
      let newParentId=null;
      const order=getRenderOrder();
      for(let i=order.length-1;i>=0;i--){
        const r=order[i];
        if(r.id===dragged.id||desc.has(r.id))continue;
        if(cx>=r.x&&cx<=r.x+r.width&&cy>=r.y&&cy<=r.y+r.height){newParentId=r.id;break;}
      }
      if(newParentId!==dragged.parentId){
        dragged.parentId=newParentId;
        if(newParentId){const np=rects.find(r=>r.id===newParentId);if(np)expandParentForChild(np,dragged);}
        render();
      }
    }
  }
  isDragging=false; dragInfo=null; isResizing=false; resizeInfo=null; waypointDrag=null;
});

canvasEl.addEventListener('dblclick', e => {
  const {x,y}=getPos(e); if(mode!=='select')return;

  const aId=hitArrowLabel(x,y)||hitArrow(x,y);
  if(aId){
    const arrow=arrows.find(a=>a.id===aId);
    if(hitArrowLabel(x,y)===aId){startEditArrow(aId);return;}
    const wi=hitWaypoint(x,y,arrow);
    if(wi>=0){arrow.waypoints.splice(wi,1);selectedId=aId;selectedType='arrow';render();updateStatus();return;}
    if(!arrow.waypoints)arrow.waypoints=[];
    const pts=getArrowPoints(arrow);
    for(let j=0;j<pts.length-1;j++){
      if(ptSegDist(x,y,pts[j].x,pts[j].y,pts[j+1].x,pts[j+1].y)<8){
        arrow.waypoints.splice(j,0,{x,y});selectedId=aId;selectedType='arrow';render();updateStatus();return;
      }
    }
    startEditArrow(aId); return;
  }

  const rId=hitRect(x,y);
  if(rId){
    if(e.ctrlKey||e.metaKey){const r=rects.find(r=>r.id===rId);openActigramme(r);return;}
    startEditRect(rId);
  }
});

canvasEl.addEventListener('contextmenu', e => {
  const {x,y}=getPos(e);
  if(selectedType==='arrow'){
    const sa=arrows.find(a=>a.id===selectedId);
    if(sa){const wi=hitWaypoint(x,y,sa);if(wi>=0){e.preventDefault();sa.waypoints.splice(wi,1);render();return;}}
  }
});

canvasEl.addEventListener('mouseleave', () => { isPanning = false; });

// ─── Label input events ──────────────────────────────────────

labelInput.addEventListener('keydown', e => {
  if(e.key==='Enter') finishEditing();
  if(e.key==='Escape') cancelEditing();
  e.stopPropagation();
});
labelInput.addEventListener('blur', finishEditing);

// ─── Keyboard shortcuts ──────────────────────────────────────

document.addEventListener('keydown', e => {
  if(editId) return;
  const ctrl=e.ctrlKey||e.metaKey;
  if(ctrl&&e.key==='s'){e.preventDefault();saveJSON();return;}
  if(ctrl&&e.key==='o'){e.preventDefault();document.getElementById('file-input').click();return;}
  if(ctrl&&e.key==='z'){e.preventDefault();undo();return;}
  if(ctrl&&(e.key==='y'||e.key==='Y')){e.preventDefault();redo();return;}
  if(ctrl&&e.key==='c'){e.preventDefault();copySelected();return;}
  if(ctrl&&e.key==='v'){e.preventDefault();pasteClipboard();return;}
  if(ctrl&&(e.key==='='||e.key==='+')){e.preventDefault();zoomAt(canvasEl.width/2,canvasEl.height/2,ZOOM_FACTOR);return;}
  if(ctrl&&e.key==='-'){e.preventDefault();zoomAt(canvasEl.width/2,canvasEl.height/2,1/ZOOM_FACTOR);return;}
  if(ctrl&&e.key==='0'){e.preventDefault();resetZoom();return;}
  switch(e.key){
    case 'Delete':case 'Backspace':deleteSelected();break;
    case 'Escape':
      if(arrowDraw){arrowDraw=null;render();}
      else if(mode!=='select'){setMode('select');}
      else{selectedId=null;selectedType=null;render();updateStatus();}
      break;
    case 's':case 'S':if(!ctrl)setMode('select');break;
    case 'r':case 'R':if(!ctrl)setMode('add-rect');break;
    case 'a':case 'A':if(!ctrl)setMode('add-arrow');break;
    case 'f':case 'F':if(!ctrl)setMode('add-free-arrow');break;
    case 'n':case 'N':if(!ctrl)renameSelected();break;
    case 'v':case 'V':if(!ctrl)fitToView();break;
    case 'l':case 'L':if(!ctrl)autoLayout();break;
    case 'q':case 'Q':if(!ctrl)alignArrowsOnly();break;
  }
});

// ─── Explorer ────────────────────────────────────────────────

function setupExplorer() {
  const rootItem     = document.getElementById('tree-root');
  const rootCaret    = document.getElementById('tree-root-caret');
  const rootChildren = document.getElementById('tree-root-children');
  if(rootItem){
    rootItem.addEventListener('click',()=>{
      const exp=rootItem.dataset.expanded==='true';
      rootItem.dataset.expanded=exp?'false':'true';
      if(rootChildren)rootChildren.style.display=exp?'none':'';
      if(rootCaret)rootCaret.textContent=exp?'\u25B8':'\u25BE';
    });
  }
  document.querySelectorAll('.tree-leaf').forEach(item=>{
    item.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',item.dataset.createType||'rect');
      e.dataTransfer.effectAllowed='copy'; item.style.opacity='0.5';
    });
    item.addEventListener('dragend',()=>{item.style.opacity='';});
  });
  container.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';container.classList.add('drag-over');});
  container.addEventListener('dragleave',e=>{if(!container.contains(e.relatedTarget))container.classList.remove('drag-over');});
  container.addEventListener('drop',e=>{
    e.preventDefault(); container.classList.remove('drag-over');
    const type=e.dataTransfer.getData('text/plain');
    const cr=canvasEl.getBoundingClientRect();
    const dropX=(e.clientX-cr.left-viewOffsetX)/viewScale;
    const dropY=(e.clientY-cr.top-viewOffsetY)/viewScale;
    if(type==='pointer'){setMode('select');return;}
    saveHistory();
    if(type==='rect'||type==='graph'||type==='mecs'){
      addRect(dropX,dropY);
      const lblMap={graph:'Graphe',mecs:'MECS'};
      if(lblMap[type]){const r=rects.find(r=>r.id===selectedId);if(r)r.label=lblMap[type];}
    } else if(['input','output','control','mechanism'].includes(type)){
      freeArrowType=type;
      const len=60; let ex=dropX, ey=dropY;
      if(type==='input'||type==='output')ex+=len;
      else if(type==='control')ey+=len;
      else if(type==='mechanism')ey-=len;
      arrows.push({id:uid(),label:'',arrowType:type,waypoints:[],startRectId:null,startAnchor:null,startX:dropX,startY:dropY,endRectId:null,endAnchor:null,endX:ex,endY:ey});
      selectedId=arrows[arrows.length-1].id; selectedType='arrow';
      const tab=currentTab(); tab.rects=rects; tab.arrows=arrows;
    }
    setMode('select'); render(); updateStatus();
  });
}

// ─── Explorer resizer ────────────────────────────────────────

function setupExplorerResizer() {
  const resizer=document.getElementById('explorer-resizer');
  const explorer=document.getElementById('explorer');
  if(!resizer||!explorer) return;
  let resizing=false;
  resizer.addEventListener('mousedown',e=>{resizing=true;resizer.classList.add('active');e.preventDefault();});
  document.addEventListener('mousemove',e=>{
    if(!resizing) return;
    const nw=e.clientX-explorer.getBoundingClientRect().left;
    if(nw>=120&&nw<=400){explorer.style.width=nw+'px';resizeCanvas();}
  });
  document.addEventListener('mouseup',()=>{if(!resizing)return;resizing=false;resizer.classList.remove('active');});
}

// ─── Ribbon wiring ───────────────────────────────────────────

function setupRibbon() {
  document.querySelectorAll('.r-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.r-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.r-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      const panel=document.getElementById('r-panel-'+tab.dataset.panel);
      if(panel)panel.classList.add('active');
    });
  });

  document.querySelectorAll('.r-btn[data-mode]').forEach(btn=>{
    btn.addEventListener('click',()=>setMode(btn.dataset.mode));
  });

  const sel=document.getElementById('arrow-type-select');
  if(sel)sel.addEventListener('change',e=>{freeArrowType=e.target.value;});

  const wire=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',fn);};

  wire('btn-add-sub-rect',()=>{
    if(selectedType==='rect')addSubRect(selectedId);
    else showStatusMsg('Sélectionnez d\'abord une fonction pour y ajouter une sous-fonction.');
  });
  wire('btn-rename',       renameSelected);
  wire('btn-delete',       deleteSelected);
  wire('btn-undo',         undo);
  wire('btn-redo',         redo);
  wire('btn-copy',         copySelected);
  wire('btn-paste',        pasteClipboard);
  wire('btn-fit-view',     fitToView);
  wire('btn-fit-view2',    fitToView);
  wire('btn-zoom-in',  ()=>zoomAt(canvasEl.width/2, canvasEl.height/2, ZOOM_FACTOR));
  wire('btn-zoom-out', ()=>zoomAt(canvasEl.width/2, canvasEl.height/2, 1/ZOOM_FACTOR));
  wire('btn-zoom-reset', resetZoom);
  wire('btn-auto-layout',  autoLayout);
  wire('btn-auto-layout2', autoLayout);
  wire('btn-align-arrows', alignArrowsOnly);
  wire('btn-align-arrows2',alignArrowsOnly);
  wire('btn-finish-sadt',  finishSADT);
  wire('btn-finish-sadt2', finishSADT);
  wire('btn-validate',     validateSADT);
  wire('btn-new-diagram',  newDiagram);
  wire('btn-save',         saveJSON);
  wire('btn-load',         ()=>document.getElementById('file-input').click());
  wire('btn-export-png',   exportPNG);
  wire('btn-open-actigramme',()=>{
    if(selectedType==='rect'){const r=rects.find(r=>r.id===selectedId);openActigramme(r);}
  });
  wire('btn-toggle-grid',()=>{
    showGrid=!showGrid;
    const btn=document.getElementById('btn-toggle-grid');
    if(btn)btn.classList.toggle('r-toggled',showGrid);
    render();
  });
  wire('btn-toggle-snap',()=>{
    snapToGrid=!snapToGrid;
    const btn=document.getElementById('btn-toggle-snap');
    if(btn)btn.classList.toggle('r-toggled',snapToGrid);
    showStatusMsg(snapToGrid?'🔲 Magnétisation activée':'🔲 Magnétisation désactivée');
  });
  wire('btn-about',()=>alert(
    'SADT Editor Pro\n\nÉditeur de diagrammes SADT professionnel.\n\n'+
    'Fonctionnalités\u00A0:\n'+
    '• Fonctions, sous-fonctions, connexions SADT\n'+
    '• Onglets multiples (Top-Level + Actigrammes)\n'+
    '• Explorateur avec glisser-déposer\n'+
    '• Annuler/Refaire (Ctrl+Z/Y)\n'+
    '• Copier/Coller (Ctrl+C/V)\n'+
    '• Grille et magnétisation\n'+
    '• Validation SADT\n'+
    '• Sauvegarde JSON et export PNG\n\n'+
    'Vanilla JavaScript — Canvas 2D API'
  ));

  const fi=document.getElementById('file-input');
  if(fi)fi.addEventListener('change',e=>{if(e.target.files[0]){loadJSON(e.target.files[0]);e.target.value='';}});
}

// ─── Tab bar wiring ──────────────────────────────────────────

function setupTabBar() {
  const btn=document.getElementById('btn-new-tab');
  if(btn)btn.addEventListener('click',()=>addNewTab('Actigramme '+tabs.length,'actigramme'));
}

// ─── Nav bar wiring ──────────────────────────────────────────

function setupNavBar() {
  const wire=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',fn);};
  wire('nav-home',()=>{
    const tl=tabs.find(t=>t.type==='top-level')||tabs[0];
    switchToTab(tl.id);
  });
  wire('nav-prev',()=>{
    const idx=tabs.findIndex(t=>t.id===currentTabId);
    if(idx>0)switchToTab(tabs[idx-1].id);
  });
  wire('nav-next',()=>{
    const idx=tabs.findIndex(t=>t.id===currentTabId);
    if(idx<tabs.length-1)switchToTab(tabs[idx+1].id);
  });
  wire('nav-up',()=>{
    const tab=currentTab();
    if(!tab.parentRectId) return;
    const parentTab=tabs.find(t=>t.rects&&t.rects.some(r=>r.id===tab.parentRectId));
    switchToTab(parentTab?(parentTab.id):(tabs.find(t=>t.type==='top-level')||tabs[0]).id);
  });
  wire('nav-down',()=>{
    if(selectedType==='rect'){const r=rects.find(r=>r.id===selectedId);openActigramme(r);}
    else showStatusMsg('Sélectionnez une fonction, puis ↓ pour ouvrir son actigramme.');
  });
}

// ─── Initialisation ──────────────────────────────────────────

function init() {
  resizeCanvas();
  setupRibbon();
  setupTabBar();
  setupNavBar();
  setupExplorer();
  setupExplorerResizer();
  renderTabBar();
  setMode('select');
  updateNavBar();
  updateUndoRedoBtns();
  updateZoomDisplay();
  new ResizeObserver(resizeCanvas).observe(container);
}

init();
