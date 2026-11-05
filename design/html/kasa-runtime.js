/* Kasa – runtime i vogël për t'i hapur ekranet e dizajnit jashtë canvas-it (vetëm për parapamje). */
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; this.__render = null; }
    setState(patch) { this.state = Object.assign({}, this.state, typeof patch === 'function' ? patch(this.state) : patch); if (this.__render) this.__render(); }
    forceUpdate() { if (this.__render) this.__render(); }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  function lookup(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    let v = scope;
    for (const part of expr.split('.')) { if (v == null) return undefined; v = v[part]; }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, (_, e) => { const v = lookup(scope, e); return v == null ? '' : String(v); });
  }
  function whole(str) { const m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(str); return m ? m[1] : null; }
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  function src(name) { return (window.__DC || {})[name] || null; }

  function parseDC(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const x = doc.querySelector('x-dc');
    const sc = doc.querySelector('script[data-dc-script]');
    let defaults = {};
    try { const p = JSON.parse(sc.getAttribute('data-props') || '{}'); for (const k in p) if (p[k] && 'default' in p[k]) defaults[k] = p[k].default; } catch (e) {}
    const Cls = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    const helmet = x.querySelector('helmet');
    let helmetHTML = '';
    if (helmet) { helmetHTML = helmet.innerHTML; helmet.remove(); }
    return { tpl: x.innerHTML, Cls, defaults, helmetHTML };
  }

  const helmetDone = new Set();
  function addHelmet(name, html) {
    if (helmetDone.has(name) || !html) return; helmetDone.add(name);
    const t = document.createElement('template'); t.innerHTML = html;
    document.head.appendChild(t.content);
  }

  function mount(container, def, props, name) {
    addHelmet(name, def.helmetHTML);
    const inst = new def.Cls(Object.assign({}, def.defaults, props));
    const render = () => {
      const vals = inst.renderVals ? inst.renderVals() : {};
      const scope = Object.assign({}, vals);
      const t = document.createElement('template'); t.innerHTML = def.tpl;
      const frag = document.createDocumentFragment();
      Array.from(t.content.childNodes).forEach((n) => renderNode(n, scope, frag));
      container.replaceChildren(frag);
    };
    inst.__render = render;
    render();
    if (inst.componentDidMount) try { inst.componentDidMount(); } catch (e) {}
  }

  function renderNode(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.textContent, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-if') {
      const e = whole(node.getAttribute('value') || '');
      if (e && lookup(scope, e)) Array.from(node.childNodes).forEach((c) => renderNode(c, scope, out));
      return;
    }
    if (tag === 'sc-for') {
      const e = whole(node.getAttribute('list') || '');
      const as = node.getAttribute('as') || 'item';
      const list = (e && lookup(scope, e)) || [];
      list.forEach((item, i) => { const s = Object.assign({}, scope, { [as]: item, $index: i }); Array.from(node.childNodes).forEach((c) => renderNode(c, s, out)); });
      return;
    }
    if (tag === 'dc-import') {
      const name = node.getAttribute('name');
      const box = document.createElement('div'); box.style.display = 'contents';
      const props = {};
      Array.from(node.attributes).forEach((a) => {
        if (a.name === 'name' || a.name.startsWith('hint-')) return;
        const w = whole(a.value); props[camel(a.name)] = w ? lookup(scope, w) : interp(a.value, scope);
      });
      const html = src(name);
      if (html) mount(box, parseDC(html), props, name);
      out.appendChild(box); return;
    }
    const el = document.createElement(node.tagName);
    Array.from(node.attributes).forEach((a) => {
      const w = whole(a.value);
      if (/^on[A-Z]/.test(a.name) || /^on[a-z]+$/.test(a.name) && w) {
        const fn = w ? lookup(scope, w) : null;
        if (typeof fn === 'function') el.addEventListener(a.name.slice(2).toLowerCase(), (ev) => { ev.preventDefault(); fn(ev); });
        return;
      }
      const v = w ? lookup(scope, w) : interp(a.value, scope);
      if (v === false || v == null) return;
      el.setAttribute(a.name, v === true ? '' : String(v));
    });
    if (tag === 'input' && el.hasAttribute('value')) el.value = el.getAttribute('value');
    const target = tag === 'template' ? el.content : el;
    Array.from((node.content || node).childNodes).forEach((c) => renderNode(c, scope, target));
    out.appendChild(el);
  }

  function boot() {
    const main = document.getElementById('dc-main');
    if (!main) return;
    const html = src('__main');
    mount(main, parseDC(html), {}, '__main');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
