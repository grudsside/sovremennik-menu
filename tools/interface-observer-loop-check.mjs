import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve(process.cwd(), 'assets/js/interface-redesign.js'), 'utf8');

assert.match(
  source,
  /tasks:\s*\['✓','Мои задачи','Актуальные задачи и сроки'\]/,
  'The legacy shell must use the same task context as interface-v3'
);
assert.match(source, /function v3OwnsShell\(\)/, 'The legacy shell must yield ownership to interface-v3');
assert.match(
  source,
  /title\.textContent !== meta\[1\]/,
  'Context title writes must be idempotent'
);
assert.match(
  source,
  /subtitle\.textContent !== meta\[2\]/,
  'Context subtitle writes must be idempotent'
);
assert.match(source, /if\(enhanceQueued \|\| v3OwnsShell\(\)\) return;/, 'Observer work must be coalesced and disabled after v3 starts');

const shellButtonIndex = source.indexOf('class="shell-menu-btn"');
const v3OwnershipGuardIndex = source.indexOf('if(v3OwnsShell()) return;');
assert.ok(shellButtonIndex >= 0, 'The structural shell must contain the mobile menu button');
assert.ok(
  v3OwnershipGuardIndex > shellButtonIndex,
  'The structural mobile shell must be created before the legacy enhancer yields to interface-v3'
);

class FakeClassList {
  constructor(...values){ this.values = new Set(values); }
  add(...values){ values.forEach(value => this.values.add(value)); }
  remove(...values){ values.forEach(value => this.values.delete(value)); }
  contains(value){ return this.values.has(value); }
  toggle(value){
    if(this.values.has(value)){
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}

let textWrites = 0;
class FakeElement {
  constructor({ text = '', classes = [] } = {}){
    this._textContent = text;
    this.classList = new FakeClassList(...classes);
    this.dataset = {};
  }
  get textContent(){ return this._textContent; }
  set textContent(value){
    textWrites += 1;
    this._textContent = String(value);
  }
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  addEventListener(){}
  setAttribute(name, value){ this[name] = String(value); }
  append(){}
  appendChild(){}
  prepend(){}
  insertBefore(){}
}

const title = new FakeElement({ text:'Мои задачи' });
const subtitle = new FakeElement({ text:'Актуальные задачи и сроки' });
const copy = new FakeElement();
copy.querySelector = selector => selector === 'strong' ? title : (selector === 'span' ? subtitle : null);

const menuButton = new FakeElement();
menuButton.dataset.bound = '1';
const context = new FakeElement();
context.querySelector = selector => selector === '.shell-menu-btn' ? menuButton : null;

const mark = new FakeElement();
const heroCopy = new FakeElement();
heroCopy.querySelector = selector => selector === '.shell-brand-mark' ? mark : null;

const hero = new FakeElement();
hero.querySelector = selector => selector === '.shell-context' ? context : null;

const navIcon = new FakeElement();
const activeTaskTab = new FakeElement({ text:'Мои задачи', classes:['main-tab', 'active'] });
activeTaskTab.dataset.topTarget = 'tasks';
activeTaskTab.querySelector = selector => selector === '.shell-nav-icon' ? navIcon : null;

const tabs = new FakeElement();
tabs.dataset.shellBound = '1';
tabs.querySelectorAll = selector => selector === '.main-tab' ? [activeTaskTab] : [];

const overlay = new FakeElement();
const userPanel = new FakeElement();
const page = new FakeElement();
const body = new FakeElement();
body.dataset = {};

const documentListeners = new Map();
const document = {
  readyState:'complete',
  body,
  querySelector(selector){
    if(selector === '.hero') return hero;
    if(selector === '.hero-copy') return heroCopy;
    if(selector === '.main-tabs') return tabs;
    if(selector === '.shell-overlay') return overlay;
    if(selector === '.shell-context-copy') return copy;
    if(selector === '.main-tab.active') return activeTaskTab;
    if(selector === '.shell-menu-btn') return menuButton;
    if(selector === '#user-panel') return userPanel;
    if(selector === '.page') return page;
    return null;
  },
  createElement(){ return new FakeElement(); },
  addEventListener(type, listener){ documentListeners.set(type, listener); }
};

let observerCallback = null;
class FakeMutationObserver {
  constructor(callback){ observerCallback = callback; }
  observe(){}
}

const animationFrames = [];
const windowListeners = new Map();
const sandbox = {
  console,
  document,
  location:{ hash:'#tasks' },
  MutationObserver:FakeMutationObserver,
  innerWidth:1280,
  requestAnimationFrame:callback => animationFrames.push(callback),
  setTimeout:callback => callback(),
  addEventListener:(type, listener) => windowListeners.set(type, listener)
};
sandbox.window = sandbox;

vm.runInNewContext(source, sandbox, { filename:'assets/js/interface-redesign.js' });

assert.equal(textWrites, 0, 'Initial enhancement must not rewrite an already-correct task context');
assert.equal(typeof observerCallback, 'function', 'The legacy observer must be installed');

observerCallback([{ type:'childList', target:page }]);
observerCallback([{ type:'childList', target:page }]);
assert.equal(animationFrames.length, 1, 'Repeated mutation batches must schedule only one enhancement frame');

animationFrames.shift()();
assert.equal(textWrites, 0, 'A child-list enhancement must not rewrite unchanged context text');
assert.equal(animationFrames.length, 0, 'The idempotent enhancement must not sustain another frame');

body.dataset.interfaceVersion = '2026-07-19-v5';
observerCallback([{ type:'childList', target:page }]);
assert.equal(animationFrames.length, 0, 'The legacy observer must become inert after interface-v3 takes ownership');
assert.equal(textWrites, 0, 'The legacy shell must not compete with interface-v3 text updates');

console.log('Interface observer loop regression check passed.');