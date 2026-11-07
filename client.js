/**
 * @local/knowledge-base — Client half (browser).
 *
 * Registers a global panel icon in `sidebar.panellist` and the panel body in
 * `main`, keyed by `knowledge-base`. The panel talks to the Host half over the
 * `/kb-api` HTTP API.
 *
 * The right-hand rail is a live tag nebula: tags are spheres, co-occurrence is
 * an edge, and clicking a sphere filters the knowledge base. Selecting tags
 * converges the sphere set to tags that co-occur with the current selection.
 */
window.__ModuleLoader__.load({
  id: '@local/knowledge-base',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    // ---------------------------------------------------------------------
    // Styles (component-local, removed on unmount)
    // ---------------------------------------------------------------------

    const PANEL_CSS = `
      .kb-root { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden; }

      .kb-header {
        display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
        min-height: 48px; padding: 8px 20px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-base);
      }
      .kb-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--dsw-alias-label-primary); white-space: nowrap; }
      .kb-title.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .kb-search {
        flex: 1 1 180px; min-width: 0; height: 32px; padding: 0 10px; border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary); font-size: 13px; outline: none;
      }
      .kb-search:focus { border-color: var(--dsw-alias-brand-primary); }
      .kb-btn {
        flex: 0 0 auto; height: 32px; padding: 0 12px; border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary); font-size: 13px; cursor: pointer; white-space: nowrap;
        display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      }
      .kb-btn:hover { background: var(--dsw-alias-bg-layer-2); }
      .kb-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
      .kb-btn.danger { color: var(--dsw-alias-state-error-primary); }

      .kb-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 20px 24px; }

      /* Split layout: main content + right-hand nebula rail. */
      .kb-split { display: flex; flex: 1 1 auto; min-height: 0; }
      .kb-main { flex: 1 1 auto; min-width: 0; overflow-y: auto; padding: 12px 20px 24px; }
      .kb-main-editor { display: flex; flex-direction: column; padding: 16px 24px; }

      /* Nebula rail. */
      .kb-rail {
        flex: 0 0 288px; border-left: 1px solid var(--dsw-alias-border-l1);
        display: flex; flex-direction: column; overflow: hidden;
        background: var(--dsw-alias-bg-base);
      }
      .kb-resizer {
        flex: 0 0 5px; cursor: col-resize; background: transparent;
        border-left: 1px solid var(--dsw-alias-border-l1);
        transition: background .12s;
      }
      .kb-resizer:hover, .kb-resizer:active { background: var(--dsw-alias-brand-primary); opacity: .35; }
      .kb-rail-head { padding: 10px 12px 4px; flex: 0 0 auto; }
      .kb-rail-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
      .kb-rail-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
      .kb-debug { margin: 6px 12px 4px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
      .kb-debug-row { display: grid; grid-template-columns: 92px 1fr 38px; align-items: center; gap: 6px; margin: 3px 0; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .kb-debug-row input[type="range"] { width: 100%; accent-color: var(--dsw-alias-brand-primary); }
      .kb-debug-value { text-align: right; font-variant-numeric: tabular-nums; }
      .kb-debug-hint { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: 4px; opacity: .8; }
      .kb-zoom { display: flex; align-items: center; gap: 4px; }
      .kb-zoom .kb-btn { height: 22px; padding: 0 6px; font-size: 11px; }
      .kb-zoom-label { font-size: 10px; color: var(--dsw-alias-label-secondary); min-width: 30px; text-align: center; }
      .kb-nebula-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; cursor: grab; }
      .kb-nebula { display: block; cursor: default; }

      .kb-edge { stroke: var(--dsw-alias-label-secondary); stroke-width: 1.1; opacity: .55; }
      .kb-edge.active { stroke: var(--dsw-alias-brand-primary); opacity: .9; stroke-width: 1.8; }
      .kb-edge.hovered { stroke: var(--dsw-alias-brand-primary); }
      .kb-node circle {
        stroke-width: 1; cursor: pointer; transition: fill-opacity .12s, stroke-opacity .12s;
      }
      .kb-node:hover circle { stroke-opacity: 1; }
      .kb-node.selected circle { stroke-opacity: 1; }
      .kb-node text { font-size: 10px; fill: var(--dsw-alias-label-primary); pointer-events: none; user-select: none; }
      .kb-node.selected text { fill: var(--dsw-alias-bg-base); font-weight: 600; }

      /* Tag explorer. */
      .kb-section-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 14px 0 6px; letter-spacing: .02em; }
      .kb-select-all { display: flex; align-items: center; gap: 6px; padding: 2px 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .kb-selected { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-bottom: 4px; }
      .kb-selected-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .kb-candidates { display: flex; flex-wrap: wrap; gap: 6px; }
      .kb-suggest { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-overlay); margin-top: 4px; overflow: hidden; }
      .kb-suggest-item { display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; font-size: 12px; color: var(--dsw-alias-label-primary); cursor: pointer; }
      .kb-suggest-item:hover { background: var(--dsw-alias-bg-layer-1); }
      .kb-suggest-count { color: var(--dsw-alias-label-secondary); font-size: 11px; }

      .kb-chip { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); }
      .kb-chip.click { cursor: pointer; }
      .kb-chip.click:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
      .kb-chip.selected { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
      .kb-chip.selected.click:hover { color: var(--dsw-alias-bg-base); }
      .kb-chip .kb-chip-count { opacity: .65; margin-left: 4px; }

      .kb-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 8px; border-radius: 8px; cursor: pointer; }
      .kb-row-check { flex: 0 0 auto; margin-top: 4px; cursor: pointer; accent-color: var(--dsw-alias-brand-primary); }
      .kb-row:hover { background: var(--dsw-alias-bg-layer-1); }
      .kb-row-main { flex: 1 1 auto; min-width: 0; }
      .kb-row-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); line-height: 1.5; }
      .kb-row-summary { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 3px; line-height: 1.6; }
      .kb-row-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .kb-row-time { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary); padding-top: 2px; white-space: nowrap; }
      .kb-row-side { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
      .kb-row-del {
        flex: 0 0 auto; width: 22px; height: 22px; line-height: 1; padding: 0; border: 0;
        border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary);
        cursor: pointer; font-size: 15px;
      }
      .kb-row-del:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); }

      .kb-empty { color: var(--dsw-alias-label-secondary); font-size: 13px; text-align: center; padding: 28px 0; }
      .kb-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }

      /* Document view. */
      .kb-doc-title { font-size: 26px; font-weight: 700; line-height: 1.3; margin: 4px 0 10px; color: var(--dsw-alias-label-primary); }
      .kb-doc-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 22px; }
      .kb-doc-content { font-size: 14px; line-height: 1.9; color: var(--dsw-alias-label-primary); max-width: 760px; }
      .kb-doc-content p { margin: 0 0 14px; white-space: pre-wrap; word-break: break-word; }
      .kb-doc-content .kb-doc-h { margin: 22px 0 8px; font-size: 15px; font-weight: 700; color: var(--dsw-alias-label-primary); letter-spacing: .01em; }
      .kb-doc-content .kb-doc-h:first-child { margin-top: 0; }
      .kb-doc-source { margin-top: 28px; font-size: 12px; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; word-break: break-all; max-width: 760px; }
      .kb-time { font-size: 11px; color: var(--dsw-alias-label-secondary); }

      /* Editor. */
      .kb-editor-title {
        width: 100%; box-sizing: border-box; border: 0; background: transparent; outline: none;
        font-size: 24px; font-weight: 700; line-height: 1.3; padding: 0 0 8px; color: var(--dsw-alias-label-primary);
      }
      .kb-editor-title::placeholder { color: var(--dsw-alias-label-secondary); opacity: .6; }
      .kb-editor-meta { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .kb-editor-meta input { flex: 1 1 160px; min-width: 0; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
      .kb-editor-meta input:focus { border-color: var(--dsw-alias-brand-primary); }
      .kb-editor-tags { padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .kb-editor-tags-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
      .kb-tag-pool { display: flex; flex-wrap: wrap; gap: 4px; max-height: 76px; overflow-y: auto; }
      .kb-tag-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .kb-tag-new { display: flex; gap: 6px; margin-top: 8px; }
      .kb-tag-suggest { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-overlay); margin-top: 4px; overflow: hidden; max-height: 150px; overflow-y: auto; }
      .kb-tag-suggest-item { display: flex; justify-content: space-between; gap: 8px; padding: 6px 10px; font-size: 12px; color: var(--dsw-alias-label-primary); cursor: pointer; }
      .kb-tag-suggest-item:hover { background: var(--dsw-alias-bg-layer-1); }
      .kb-tag-suggest-count { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .kb-tag-input { flex: 1 1 160px; min-width: 0; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
      .kb-tag-input:focus { border-color: var(--dsw-alias-brand-primary); }
      .kb-tag-selected { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
      .kb-editor-body { flex: 1 1 auto; min-height: 0; width: 100%; box-sizing: border-box; margin-top: 10px; border: 0; background: transparent; resize: none; outline: none; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 1.9; }
      .kb-editor-body::placeholder { color: var(--dsw-alias-label-secondary); opacity: .6; }
    `;

    // ---------------------------------------------------------------------
    // Icons
    // ---------------------------------------------------------------------

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 20;
      const active = props && props.active;
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)';
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', {
          d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
          stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
          stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      );
    }

    function PlusIcon(props) {
      const size = props && props.size ? props.size : 15;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' }),
      );
    }

    // ---------------------------------------------------------------------
    // Text
    // ---------------------------------------------------------------------

    const T = {
      title: '知识库',
      search: '搜索或选择标签…',
      create: '新建',
      importBtn: '导入',
      back: '返回',
      cancel: '取消',
      save: '保存',
      delete: '删除',
      edit: '编辑',
      empty: '知识库里还没有条目。点「新建」添加，或在对话里让我帮你记录。',
      loading: '加载中…',
      selected: '已选标签：',
      results: (n) => `匹配条目（${n}）`,
      noResults: '没有同时包含这些标签的条目。',
      deleteConfirm: '确认删除该条目？',
      noContent: '（这条还没有正文）',
      nebulaTitle: '标签星云',
      nebulaHint: '点球体筛选，再点一次取消',
      editorTitle: '标题',
      editorBody: '开始写正文…',
      editorSummary: '摘要（可选）',
      editorSource: '来源 URL（可选）',
      tagNew: '新建标签，回车添加',
      tagAdd: '添加',
    };

    // ---------------------------------------------------------------------
    // Layout: a one-shot force simulation over the tag graph.
    // ---------------------------------------------------------------------

    function fmtTime(ts) {
      if (!ts) return '';
      try {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } catch {
        return '';
      }
    }

    function computeLayout(nodes, edges, width, height) {
      const pos = new Map();
      const n = nodes.length;
      if (n === 0) return pos;
      const radius = Math.min(width, height) * 0.32;
      nodes.forEach((node, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        pos.set(node.name, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius });
      });
      const names = nodes.map((node) => node.name);
      const edgeList = edges.filter((edge) => pos.has(edge.a) && pos.has(edge.b));

      // Rest length grows with node count so the graph breathes instead of
      // compressing every node into one fixed rectangle.
      const restLen = 90 + Math.sqrt(n) * 16;
      const repulsion = 20000;
      const margin = 30;

      for (let iter = 0; iter < 320; iter += 1) {
        const force = new Map();
        for (const name of names) force.set(name, { x: 0, y: 0 });

        // Repulsion between every pair.
        for (let i = 0; i < n; i += 1) {
          for (let j = i + 1; j < n; j += 1) {
            const a = pos.get(names[i]);
            const b = pos.get(names[j]);
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const rep = repulsion / (dist * dist);
            const ux = dx / dist;
            const uy = dy / dist;
            force.get(names[i]).x += ux * rep;
            force.get(names[i]).y += uy * rep;
            force.get(names[j]).x -= ux * rep;
            force.get(names[j]).y -= uy * rep;
          }
        }

        // Attraction along co-occurrence edges: the stronger the co-occurrence,
        // the harder the pair is pulled together.
        for (const edge of edgeList) {
          const a = pos.get(edge.a);
          const b = pos.get(edge.b);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const weight = 1 + Math.log2((edge.count || 1) + 1);
          const att = (dist - restLen) * 0.009 * weight;
          const ux = dx / dist;
          const uy = dy / dist;
          force.get(edge.a).x += ux * att;
          force.get(edge.a).y += uy * att;
          force.get(edge.b).x -= ux * att;
          force.get(edge.b).y -= uy * att;
        }

        // Centering + integration + bounds.
        for (const name of names) {
          const p = pos.get(name);
          const f = force.get(name);
          f.x += (width / 2 - p.x) * 0.0012;
          f.y += (height / 2 - p.y) * 0.0012;
          p.x += f.x * 0.35;
          p.y += f.y * 0.35;
          p.x = Math.max(margin, Math.min(width - margin, p.x));
          p.y = Math.max(margin, Math.min(height - margin, p.y));
        }
      }
      return pos;
    }

    // ---------------------------------------------------------------------
    // Nebula graph
    // ---------------------------------------------------------------------

    // Detect the current theme by the luminance of the base background token.
    function isDarkTheme() {
      if (typeof document === 'undefined') return false;
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim();
      if (!raw) return false;
      let hex = raw;
      if (/^#[0-9a-f]{3}$/i.test(hex)) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      if (/^#[0-9a-f]{6}$/i.test(hex)) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return r * 0.299 + g * 0.587 + b * 0.114 < 128;
      }
      const m = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (m) {
        const r = Number(m[1]);
        const g = Number(m[2]);
        const b = Number(m[3]);
        return r * 0.299 + g * 0.587 + b * 0.114 < 128;
      }
      return false;
    }

    function TagNebula({ candidates, edges, selectedTags, allTags, onToggle, onDeleteTag, width, height, scale = 1, onScale, visual, toneMin = 0.35, toneMax = 0.88, textOffset = 0, hoverStroke = 3 }) {
      // Count per tag: candidates carry the co-occurring count, allTags the global count.
      const countMap = useMemo(() => {
        const map = new Map();
        for (const t of allTags) map.set(t.name, t.count);
        for (const c of candidates) map.set(c.name, c.count);
        return map;
      }, [candidates, allTags]);

      const nodes = useMemo(() => {
        const map = new Map();
        for (const cand of candidates) map.set(cand.name, { name: cand.name, count: cand.count });
        for (const tag of selectedTags) {
          if (!map.has(tag)) map.set(tag, { name: tag, count: countMap.get(tag) || 1 });
        }
        return [...map.values()];
      }, [candidates, selectedTags, countMap]);

      // Canvas grows with the number of tags so the graph spreads out freely.
      const scaleFactor = Math.sqrt(Math.max(nodes.length, 1));
      const canvasWidth = Math.max(width, Math.round(scaleFactor * 210));
      const canvasHeight = Math.max(height, Math.round(scaleFactor * 175));
      const layout = useMemo(() => computeLayout(nodes, edges, canvasWidth, canvasHeight), [nodes, edges, canvasWidth, canvasHeight]);
      const selectedSet = useMemo(() => new Set(selectedTags), [selectedTags]);
      const maxCount = useMemo(() => Math.max(1, ...nodes.map((node) => node.count || 1)), [nodes]);
      const maxEdgeCount = useMemo(() => Math.max(1, ...edges.map((edge) => edge.count || 1)), [edges]);
      const [hoverNode, setHoverNode] = useState(null);
      const darkMode = isDarkTheme();
      // The hovered node's 1-hop neighbourhood (itself + direct neighbours).
      const hoverNeighbors = useMemo(() => {
        if (!hoverNode) return null;
        const set = new Set([hoverNode]);
        for (const edge of edges) {
          if (edge.a === hoverNode) set.add(edge.b);
          else if (edge.b === hoverNode) set.add(edge.a);
        }
        return set;
      }, [hoverNode, edges]);
      const svgRef = useRef(null);

      // Open the viewport centered on the whole graph.
      useEffect(() => {
        const el = svgRef.current;
        if (!el) return undefined;
        const scroller = el.parentElement;
        if (!scroller) return undefined;
        const center = () => {
          scroller.scrollLeft = Math.max(0, (canvasWidth - scroller.clientWidth) / 2);
          scroller.scrollTop = Math.max(0, (canvasHeight - scroller.clientHeight) / 2);
        };
        const timer = setTimeout(center, 0);
        return () => clearTimeout(timer);
      }, [canvasWidth, canvasHeight]);

      // Wheel zoom with hard limits (0.5x - 2.5x).
      useEffect(() => {
        const el = svgRef.current;
        if (!el || typeof onScale !== 'function') return undefined;
        const onWheel = (event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.12 : 0.89;
          onScale((s) => Math.max(0.5, Math.min(2.5, s * factor)));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
      }, [onScale]);

      // Middle-mouse drag pans the oversized canvas.
      useEffect(() => {
        const el = svgRef.current;
        if (!el) return undefined;
        let panning = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        const scrollerOf = () => el.parentElement;
        const onDown = (event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          const scroller = scrollerOf();
          if (!scroller) return;
          panning = true;
          startX = event.clientX;
          startY = event.clientY;
          startLeft = scroller.scrollLeft;
          startTop = scroller.scrollTop;
          scroller.style.cursor = 'grabbing';
        };
        const onMove = (event) => {
          if (!panning) return;
          const scroller = scrollerOf();
          if (!scroller) return;
          scroller.scrollLeft = startLeft - (event.clientX - startX);
          scroller.scrollTop = startTop - (event.clientY - startY);
        };
        const onUp = () => {
          if (!panning) return;
          panning = false;
          const scroller = scrollerOf();
          if (scroller) scroller.style.cursor = '';
        };
        el.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
          el.removeEventListener('mousedown', onDown);
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
      }, []);

      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;

      return h('svg', {
        ref: svgRef, className: 'kb-nebula',
        viewBox: '0 0 ' + canvasWidth + ' ' + canvasHeight,
        preserveAspectRatio: 'xMidYMid meet',
        style: { width: canvasWidth + 'px', height: canvasHeight + 'px' },
      },
        h('g', { transform: `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})` },
          edges.map((edge, i) => {
            const a = layout.get(edge.a);
            const b = layout.get(edge.b);
            if (!a || !b) return null;
            const active = selectedSet.has(edge.a) && selectedSet.has(edge.b);
            const hovered = hoverNeighbors !== null && hoverNeighbors.has(edge.a) && hoverNeighbors.has(edge.b);
            const strength = Math.min(1, (edge.count || 1) / maxEdgeCount);
            const baseOpacity = visual.edgeOpacity * (0.65 + strength * 0.7);
            const baseWidth = visual.edgeWidth * (0.6 + strength * 1.1);
            return h('line', {
              key: 'e' + i,
              className: 'kb-edge' + (active ? ' active' : '') + (hovered ? ' hovered' : ''),
              x1: a.x, y1: a.y, x2: b.x, y2: b.y,
              style: active
                ? { strokeWidth: visual.edgeActiveWidth }
                : hovered
                  ? { strokeOpacity: Math.min(1, baseOpacity + 0.35), strokeWidth: baseWidth * 1.7 }
                  : { strokeOpacity: baseOpacity, strokeWidth: baseWidth },
            });
          }),
          nodes.map((node) => {
            const p = layout.get(node.name) || { x: 100, y: 100 };
            const selected = selectedSet.has(node.name);
            const count = node.count || 1;
            const r = visual.ballBaseR + Math.min(visual.ballRadiusMax, count * visual.ballRadiusStep);
            const t = maxCount > 1 ? (count - 1) / (maxCount - 1) : 1;
            const tone = darkMode
              ? toneMax + t * (toneMin - toneMax)
              : toneMin + t * (toneMax - toneMin); // 0 = pure black, 1 = pure white
            const gray = Math.round(Math.max(0, Math.min(1, tone)) * 255);
            const fill = `rgb(${gray}, ${gray}, ${gray})`;
            const textColor = tone > 0.55 ? '#111111' : '#ffffff';
            const isHovered = hoverNeighbors !== null && hoverNeighbors.has(node.name);
            return h('g', {
              key: node.name,
              className: 'kb-node' + (selected ? ' selected' : '') + (isHovered ? ' hovered' : ''),
              onClick: () => onToggle(node.name),
              onContextMenu: (e) => { e.preventDefault(); if (onDeleteTag) onDeleteTag(node.name); },
              onMouseEnter: () => setHoverNode(node.name),
              onMouseLeave: () => setHoverNode(null),
              role: 'button', tabIndex: 0,
            },
              h('circle', {
                cx: p.x, cy: p.y, r,
                style: {
                  fill,
                  fillOpacity: 1,
                  stroke: isHovered ? '#000000' : fill,
                  strokeOpacity: 1,
                  strokeWidth: isHovered ? hoverStroke : 1,
                },
              }),
              h('text', {
                x: p.x, y: p.y, textAnchor: 'middle', dominantBaseline: 'central',
                style: { fontSize: Math.max(4, visual.ballTextSize * (0.72 + t * 0.6) + textOffset).toFixed(1) + 'px', fill: textColor },
              }, node.name),
            );
          }),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Panel
    // ---------------------------------------------------------------------

    function KnowledgePanel() {
      const [selectedTags, setSelectedTags] = useState([]);
      const [tagInput, setTagInput] = useState('');
      const [candidates, setCandidates] = useState([]);
      const [edges, setEdges] = useState([]);
      const [results, setResults] = useState([]);
      const [allTags, setAllTags] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [view, setView] = useState({ kind: 'list' });
      const [draft, setDraft] = useState(null);
      const [newTag, setNewTag] = useState('');
      const fileRef = useRef(null);
      const [nebulaScale, setNebulaScale] = useState(1);
      const [railWidth, setRailWidth] = useState(560);
      const [debugOpen, setDebugOpen] = useState(false);
      const [toneMin, setToneMin] = useState(0.85);
      const [toneMax, setToneMax] = useState(0.15);
      const [textOffset, setTextOffset] = useState(3);
      const [hoverStroke, setHoverStroke] = useState(3);
      // Fixed nebula visual tuning (debug panel removed once the look was settled).
      const visual = {
        ballBaseR: 14,
        ballRadiusStep: 9,
        ballRadiusMax: 26,
        ballFillOpacityMin: 1,
        ballFillOpacityMax: 1,
        ballStrokeOpacityMin: 1,
        ballStrokeOpacityMax: 1,
        ballTextSize: 10,
        ballSaturate: 1,
        ballGrayscale: 0,
        ballContrast: 1.8,
        edgeWidth: 1.1,
        edgeOpacity: 0.55,
        edgeActiveWidth: 1.8,
      };
      const [exploreReload, setExploreReload] = useState(0);
      const [relatedTags, setRelatedTags] = useState([]);
      const [checkedIds, setCheckedIds] = useState([]);

      // Nebula size (fixed so the force layout stays stable).
      const nebulaSize = { width: 288, height: 420 };

      useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        const params = new URLSearchParams();
        if (selectedTags.length) params.set('tags', selectedTags.join(','));
        const qs = params.toString();
        fetch('/kb-api/explore' + (qs ? `?${qs}` : ''))
          .then((res) => res.json())
          .then((data) => {
            if (cancelled) return;
            setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
            setEdges(Array.isArray(data.edges) ? data.edges : []);
            setResults(Array.isArray(data.entries) ? data.entries : []);
          })
          .catch((err) => {
            if (!cancelled) setError(String(err && err.message ? err.message : err));
          })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }, [selectedTags, exploreReload]);

      // Related existing tags for the editor, derived from the draft text.
      useEffect(() => {
        if (!draft) { setRelatedTags([]); return undefined; }
        const text = [draft.title, draft.content, draft.summary].filter(Boolean).join('\n').trim();
        if (!text) { setRelatedTags([]); return undefined; }
        const timer = setTimeout(() => {
          fetch('/kb-api/related-tags', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then((res) => res.json())
            .then((data) => setRelatedTags(Array.isArray(data.tags) ? data.tags : []))
            .catch(() => setRelatedTags([]));
        }, 300);
        return () => clearTimeout(timer);
      }, [draft ? draft.title : '', draft ? draft.content : '', draft ? draft.summary : '']);

      const reloadAllTags = useCallback(() => {
        fetch('/kb-api/tags')
          .then((res) => res.json())
          .then((data) => setAllTags(Array.isArray(data.tags) ? data.tags : []))
          .catch(() => {});
      }, []);

      useEffect(() => { reloadAllTags(); }, [reloadAllTags]);

      const toggleTag = (tag) => {
        setSelectedTags((tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]));
        setTagInput('');
      };

      const suggestions = useMemo(() => {
        const q = tagInput.trim().toLowerCase();
        if (!q) return [];
        return allTags
          .filter(({ name }) => name.toLowerCase().includes(q) && !selectedTags.includes(name))
          .slice(0, 8);
      }, [tagInput, allTags, selectedTags]);

      const draftTagSuggestions = useMemo(() => {
        const q = newTag.trim().toLowerCase();
        if (!q) return [];
        return allTags
          .filter(({ name }) => name.toLowerCase().includes(q) && !(draft && draft.tags.includes(name)))
          .slice(0, 8);
      }, [newTag, allTags, draft]);

      const openEntry = (entry) => setView({ kind: 'detail', entry });

      const startEdit = (entry) => {
        setDraft({
          title: entry ? entry.title : '',
          content: entry ? entry.content : '',
          summary: entry ? entry.summary || '' : '',
          tags: entry ? [...(entry.tags || [])] : [],
          category: entry ? entry.category || '' : '',
          sourceUrl: entry ? entry.sourceUrl || '' : '',
        });
        setView({ kind: 'edit', entry: entry || null });
      };

      const saveDraft = async () => {
        if (!draft) return;
        const payload = {
          title: draft.title,
          content: draft.content,
          summary: draft.summary,
          tags: draft.tags,
          category: draft.category,
          sourceUrl: draft.sourceUrl,
        };
        try {
          if (view.kind === 'edit' && view.entry) {
            await fetch(`/kb-api/entries/${encodeURIComponent(view.entry.id)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
          } else {
            await fetch('/kb-api/entries', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
          }
          setView({ kind: 'list' });
          setDraft(null);
          reloadAllTags();
          setExploreReload((n) => n + 1);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      };

      const onDelete = async (entry) => {
        if (!window.confirm(T.deleteConfirm)) return;
        try {
          await fetch(`/kb-api/entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
          setView({ kind: 'list' });
          reloadAllTags();
          setExploreReload((n) => n + 1);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      };

      const deleteTag = async (name) => {
        if (!window.confirm(`删除标签「${name}」？会从所有条目中移除该标签。`)) return;
        try {
          await fetch('/kb-api/tags/' + encodeURIComponent(name), { method: 'DELETE' });
          setSelectedTags((tags) => tags.filter((t) => t !== name));
          reloadAllTags();
          setExploreReload((n) => n + 1);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      };

      const toggleCheck = (id) => {
        setCheckedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
      };

      const batchDelete = async () => {
        if (checkedIds.length === 0) return;
        if (!window.confirm(`删除选中的 ${checkedIds.length} 个条目？`)) return;
        try {
          await fetch('/kb-api/entries/batch-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: checkedIds }),
          });
          setCheckedIds([]);
          reloadAllTags();
          setExploreReload((n) => n + 1);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      };

      const onImportFile = async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const format = /\.json$/i.test(file.name) || file.type === 'application/json' ? 'json' : 'markdown';
          const res = await fetch('/kb-api/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ format, text }),
          });
          const data = await res.json();
          if (data.error) setError(data.error);
          else { reloadAllTags(); setSelectedTags((tags) => [...tags]); }
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        } finally {
          event.target.value = '';
        }
      };

      const setDraftField = (key) => (event) => setDraft((d) => ({ ...d, [key]: event.target.value }));

      const toggleDraftTag = (tag) => {
        setDraft((d) => {
          if (!d) return d;
          const tags = d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag];
          return { ...d, tags };
        });
      };

      const addDraftTag = () => {
        const tag = newTag.trim();
        if (!tag) return;
        setDraft((d) => (d && !d.tags.includes(tag) ? { ...d, tags: [...d.tags, tag] } : d));
        setNewTag('');
      };

      const startResize = (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = railWidth;
        const onMove = (ev) => {
          const delta = startX - ev.clientX;
          // Allow the nebula rail to grow large; keep at least 260px for the list.
          const maxWidth = Math.max(560, window.innerWidth - 260);
          setRailWidth(Math.max(180, Math.min(maxWidth, startWidth + delta)));
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      };

      const renderNebula = () =>
        h(React.Fragment, null,
          h('div', { className: 'kb-resizer', onMouseDown: startResize, title: '拖动调整宽度' }),
          h('aside', { className: 'kb-rail', style: { flex: `0 0 ${railWidth}px` } },
            h('div', { className: 'kb-rail-head' },
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                h('div', { className: 'kb-rail-title' }, T.nebulaTitle),
                h('div', { className: 'kb-zoom' },
                  h('button', { className: 'kb-btn', title: '缩小', onClick: () => setNebulaScale((s) => Math.max(0.5, s / 1.2)) }, '−'),
                  h('span', { className: 'kb-zoom-label' }, Math.round(nebulaScale * 100) + '%'),
                  h('button', { className: 'kb-btn', title: '放大', onClick: () => setNebulaScale((s) => Math.min(2.5, s * 1.2)) }, '+'),
                  h('button', { className: 'kb-btn', title: '重置', onClick: () => setNebulaScale(1) }, '重置'),
                  h('button', {
                    className: 'kb-btn' + (debugOpen ? ' primary' : ''),
                    title: '视觉调试',
                    onClick: () => setDebugOpen((v) => !v),
                  }, '⚙'),
                ),
              ),
              h('div', { className: 'kb-rail-hint' }, T.nebulaHint),
              debugOpen
                ? h('div', { className: 'kb-debug' },
                    h('label', { className: 'kb-debug-row' },
                      h('span', { className: 'kb-debug-label' }, '最小球明度'),
                      h('input', {
                        type: 'range', min: 0, max: 1, step: 0.01, value: toneMin,
                        onChange: (e) => setToneMin(Number(e.target.value)),
                      }),
                      h('span', { className: 'kb-debug-value' }, String(toneMin)),
                    ),
                    h('label', { className: 'kb-debug-row' },
                      h('span', { className: 'kb-debug-label' }, '最大球明度'),
                      h('input', {
                        type: 'range', min: 0, max: 1, step: 0.01, value: toneMax,
                        onChange: (e) => setToneMax(Number(e.target.value)),
                      }),
                      h('span', { className: 'kb-debug-value' }, String(toneMax)),
                    ),
                    h('label', { className: 'kb-debug-row' },
                      h('span', { className: 'kb-debug-label' }, '字体修正'),
                      h('input', {
                        type: 'range', min: -6, max: 10, step: 1, value: textOffset,
                        onChange: (e) => setTextOffset(Number(e.target.value)),
                      }),
                      h('span', { className: 'kb-debug-value' }, (textOffset > 0 ? '+' : '') + textOffset),
                    ),
                    h('label', { className: 'kb-debug-row' },
                      h('span', { className: 'kb-debug-label' }, '悬浮描边'),
                      h('input', {
                        type: 'range', min: 1, max: 8, step: 0.5, value: hoverStroke,
                        onChange: (e) => setHoverStroke(Number(e.target.value)),
                      }),
                      h('span', { className: 'kb-debug-value' }, String(hoverStroke)),
                    ),
                    h('div', { className: 'kb-debug-hint' }, '0 = 纯黑，1 = 纯白；中间球自动插值'),
                  )
                : null,
            ),
            h('div', { className: 'kb-nebula-scroll' },
              h(TagNebula, {
                candidates, edges, selectedTags, allTags, onToggle: toggleTag, onDeleteTag: deleteTag,
                width: railWidth, height: nebulaSize.height,
                scale: nebulaScale, onScale: setNebulaScale,
                visual, toneMin, toneMax, textOffset, hoverStroke,
              }),
            ),
          ),
        );

      // --- List view: entries + nebula -----------------------------------
      if (view.kind === 'list') {
        return h('div', { className: 'kb-root' },
          h('div', { className: 'kb-header' },
            h('p', { className: 'kb-title' }, T.title),
            h('input', {
              className: 'kb-search', placeholder: T.search, value: tagInput,
              onChange: (e) => setTagInput(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') toggleTag(tagInput); },
            }),
            h('button', { className: 'kb-btn', onClick: () => fileRef.current && fileRef.current.click() }, T.importBtn),
            checkedIds.length > 0
              ? h('button', { className: 'kb-btn danger', onClick: batchDelete }, `删除选中（${checkedIds.length}）`)
              : null,
            h('button', { className: 'kb-btn primary', onClick: () => startEdit(null) }, h(PlusIcon), T.create),
            h('input', {
              type: 'file', ref: fileRef,
              accept: '.md,.markdown,.json,text/markdown,application/json',
              style: { display: 'none' }, onChange: onImportFile,
            }),
          ),
          h('div', { className: 'kb-split' },
            h('div', { className: 'kb-main' },
              error ? h('div', { className: 'kb-empty' }, h('span', { className: 'kb-error' }, error)) : null,

              selectedTags.length
                ? h('div', { className: 'kb-selected' },
                    h('span', { className: 'kb-selected-label' }, T.selected),
                    selectedTags.map((tag) =>
                      h('span', {
                        className: 'kb-chip selected click', key: tag,
                        onClick: () => toggleTag(tag), title: '点击移除',
                      }, tag + ' ×'),
                    ),
                    h('button', { className: 'kb-btn', style: { height: 26, fontSize: 12 }, onClick: () => setSelectedTags([]) }, '清除'),
                  )
                : null,

              suggestions.length
                ? h('div', { className: 'kb-suggest' },
                    suggestions.map(({ name, count }) =>
                      h('div', { className: 'kb-suggest-item', key: name, onClick: () => toggleTag(name) },
                        name,
                        h('span', { className: 'kb-suggest-count' }, count + ' 条'),
                      ),
                    ),
                  )
                : null,

              h('div', { className: 'kb-section-title' }, T.results(results.length)),
              results.length > 0
                ? h('div', { className: 'kb-select-all' },
                    h('input', {
                      type: 'checkbox', className: 'kb-row-check',
                      checked: results.every((entry) => checkedIds.includes(entry.id)),
                      onChange: (e) => setCheckedIds(e.target.checked ? results.map((entry) => entry.id) : []),
                    }),
                    h('span', null, '全选'),
                  )
                : null,
              loading
                ? h('div', { className: 'kb-empty' }, T.loading)
                : results.length === 0
                  ? h('div', { className: 'kb-empty' }, T.noResults)
                  : results.map((entry) =>
                      h('div', { className: 'kb-row', key: entry.id, onClick: () => openEntry(entry), role: 'button', tabIndex: 0 },
                        h('input', {
                          type: 'checkbox', className: 'kb-row-check',
                          checked: checkedIds.includes(entry.id),
                          onClick: (e) => e.stopPropagation(),
                          onChange: () => toggleCheck(entry.id),
                        }),
                        h('div', { className: 'kb-row-main' },
                          h('div', { className: 'kb-row-title' }, entry.title),
                          entry.summary ? h('div', { className: 'kb-row-summary' }, entry.summary) : null,
                          (entry.tags || []).length
                            ? h('div', { className: 'kb-row-tags' },
                                entry.tags.map((tag) =>
                                  h('span', { className: 'kb-chip click', key: tag, onClick: (e) => { e.stopPropagation(); toggleTag(tag); } }, tag),
                                ),
                              )
                            : null,
                        ),
                        h('span', { className: 'kb-row-time' }, fmtTime(entry.updatedAt)),
                      ),
                    ),
            ),
            renderNebula(),
          ),
        );
      }

      // --- Document view -------------------------------------------------
      const renderParagraph = (text, index) => {
        const t = String(text || '').trim();
        if (!t) return null;
        const isHeading = t.length <= 24 && !/[。，、；]$/.test(t) && !/^[•\d]/.test(t);
        return isHeading
          ? h('h3', { key: index, className: 'kb-doc-h' }, t)
          : h('p', { key: index }, t);
      };

      if (view.kind === 'detail') {
        const entry = view.entry;
        const paragraphs = String(entry.content || '').split(/\n{2,}/).filter((p) => p.trim() !== '');
        return h('div', { className: 'kb-root' },
          h('div', { className: 'kb-header' },
            h('button', { className: 'kb-btn', onClick: () => setView({ kind: 'list' }) }, '← ' + T.back),
            h('p', { className: 'kb-title grow' }, entry.title),
            h('button', { className: 'kb-btn', onClick: () => startEdit(entry) }, T.edit),
            h('button', { className: 'kb-btn danger', onClick: () => onDelete(entry) }, T.delete),
          ),
          h('div', { className: 'kb-split' },
            h('div', { className: 'kb-main' },
              h('h1', { className: 'kb-doc-title' }, entry.title),
              h('div', { className: 'kb-doc-meta' },
                (entry.tags || []).map((tag) => h('span', { className: 'kb-chip', key: tag }, tag)),
                h('span', { className: 'kb-time' }, entry.updatedAt ? `更新于 ${fmtTime(entry.updatedAt)}` : ''),
              ),
              paragraphs.length
                ? h('div', { className: 'kb-doc-content' }, paragraphs.map((p, i) => renderParagraph(p, i)))
                : h('div', { className: 'kb-doc-content' }, h('p', null, T.noContent)),
              entry.sourceUrl ? h('div', { className: 'kb-doc-source' }, '来源：' + entry.sourceUrl) : null,
            ),
            renderNebula(),
          ),
        );
      }

      // --- Editor view ---------------------------------------------------
      return h('div', { className: 'kb-root' },
        h('div', { className: 'kb-header' },
          h('button', { className: 'kb-btn', onClick: () => setView({ kind: 'list' }) }, '← ' + T.back),
          h('p', { className: 'kb-title' }, view.entry ? T.edit : T.create),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'kb-btn', onClick: () => setView({ kind: 'list' }) }, T.cancel),
          h('button', { className: 'kb-btn primary', onClick: saveDraft }, T.save),
        ),
        h('div', { className: 'kb-split' },
          h('div', { className: 'kb-main kb-main-editor' },
            h('input', {
              className: 'kb-editor-title', placeholder: T.editorTitle,
              value: draft ? draft.title : '', onChange: setDraftField('title'),
            }),
            h('div', { className: 'kb-editor-meta' },
              h('input', { placeholder: T.editorSummary, value: draft ? draft.summary : '', onChange: setDraftField('summary') }),
              h('input', { placeholder: T.editorSource, value: draft ? draft.sourceUrl : '', onChange: setDraftField('sourceUrl') }),
            ),
            h('div', { className: 'kb-editor-tags' },
              h('div', { className: 'kb-editor-tags-label' }, '标签'),
              h('div', { className: 'kb-tag-pool' },
                relatedTags.length === 0
                  ? h('span', { className: 'kb-tag-hint' }, '输入标题或正文后，这里会显示相关的已有标签')
                  : relatedTags.map(({ name, count }) =>
                      h('span', {
                        key: name,
                        className: 'kb-chip click' + (draft && draft.tags.includes(name) ? ' selected' : ''),
                        title: `${count} 个条目使用`,
                        onClick: () => toggleDraftTag(name),
                      }, name),
                    ),
              ),
              h('div', { className: 'kb-tag-new' },
                h('input', {
                  className: 'kb-tag-input', placeholder: T.tagNew, value: newTag,
                  onChange: (e) => setNewTag(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addDraftTag(); } },
                }),
                h('button', { className: 'kb-btn', onClick: addDraftTag }, T.tagAdd),
              ),
              draftTagSuggestions.length
                ? h('div', { className: 'kb-tag-suggest' },
                    draftTagSuggestions.map(({ name, count }) =>
                      h('div', {
                        key: name, className: 'kb-tag-suggest-item',
                        onClick: () => { toggleDraftTag(name); setNewTag(''); },
                      },
                        name,
                        h('span', { className: 'kb-tag-suggest-count' }, count + ' 条'),
                      ),
                    ),
                  )
                : null,
              draft && draft.tags.length
                ? h('div', { className: 'kb-tag-selected' },
                    draft.tags.map((tag) => h('span', {
                      className: 'kb-chip click', key: tag, onClick: () => toggleDraftTag(tag), title: '点击移除',
                    }, tag + ' ×')),
                  )
                : null,
            ),
            h('textarea', {
              className: 'kb-editor-body', placeholder: T.editorBody,
              value: draft ? draft.content : '', onChange: setDraftField('content'),
            }),
          ),
          renderNebula(),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    return {
      inject: ['slots'],
      apply(ctx) {
        if (typeof document !== 'undefined') {
          const styleEl = document.createElement('style');
          styleEl.setAttribute('data-kb-styles', 'knowledge-base');
          styleEl.textContent = PANEL_CSS;
          document.head.appendChild(styleEl);
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'knowledge-base',
          order: 30,
          label: () => T.title,
        }, PanelIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'knowledge-base',
        }, KnowledgePanel));
      },
    };
  },
});
