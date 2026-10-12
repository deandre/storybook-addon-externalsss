export const panelStyles = `
.externalsss, .externalsss * { box-sizing: border-box; }
.externalsss {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  container: externalsss-panel / inline-size;
  overflow: hidden;
  color: var(--ext-text);
  background: var(--ext-bg);
  font-family: var(--ext-font);
  font-size: 12px;
}
.externalsss button, .externalsss select { font: inherit; }
.externalsss button:focus-visible, .externalsss select:focus-visible,
.externalsss a:focus-visible, .externalsss summary:focus-visible {
  outline: 2px solid var(--ext-focus);
  outline-offset: 2px;
}
.ext-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  min-height: 50px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--ext-border);
}
.ext-heading { min-width: 0; }
.ext-heading h2 { margin: 0; font-size: 15px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; }
.ext-heading p { margin: 2px 0 0; color: var(--ext-muted); line-height: 1.3; }
.ext-actions { display: flex; align-items: center; flex-wrap: wrap; max-width: 100%; gap: 7px; flex: none; }
.ext-button {
  min-height: 32px;
  padding: 5px 11px;
  border: 1px solid var(--ext-border);
  border-radius: 5px;
  background: var(--ext-surface);
  color: var(--ext-text);
  cursor: pointer;
  white-space: nowrap;
}
.ext-button:hover:not(:disabled) { background: var(--ext-hover); }
.ext-button:active:not(:disabled) { transform: translateY(1px); }
.ext-button:disabled { cursor: not-allowed; opacity: 0.55; }
.ext-button--primary { border-color: var(--ext-primary); background: var(--ext-primary); color: var(--ext-primary-text); font-weight: 600; }
.ext-button--primary:hover:not(:disabled) { background: var(--ext-primary-hover); }
.ext-status {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 5px 16px 7px;
  border-bottom: 1px solid var(--ext-border);
  overflow: hidden;
}
.ext-status strong { font-weight: 650; white-space: nowrap; }
.ext-status-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ext-muted); }
.ext-status--partial strong { color: var(--ext-warning); }
.ext-status--error strong { color: var(--ext-failure); }
.ext-error { margin: 0; padding: 7px 16px; border-bottom: 1px solid var(--ext-border); color: var(--ext-failure); }
.ext-progress { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; background: var(--ext-border); }
.ext-progress span { display: block; width: 100%; height: 100%; background: var(--ext-primary); transform-origin: left; transition: transform 180ms ease-out; }
.ext-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 37px;
  padding: 3px 16px;
  border-bottom: 1px solid var(--ext-border);
}
.ext-filters { display: flex; align-items: center; gap: 5px; min-width: 0; }
.ext-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 29px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--ext-muted);
  cursor: pointer;
  white-space: nowrap;
}
.ext-filter strong { font-variant-numeric: tabular-nums; color: var(--ext-text); font-weight: 650; }
.ext-filter:hover { background: var(--ext-hover); color: var(--ext-text); }
.ext-filter[aria-pressed="true"] { border-color: var(--ext-border); background: var(--ext-surface); color: var(--ext-text); }
.ext-filter-select { display: none; width: 100%; min-height: 30px; border: 1px solid var(--ext-border); border-radius: 5px; background: var(--ext-surface); color: var(--ext-text); padding: 4px 8px; }
.ext-results { flex: 1; min-height: 0; overflow: auto; padding: 0 16px 12px; scrollbar-color: var(--ext-border) transparent; }
.ext-results::selection, .ext-results *::selection { background: var(--ext-selection); }
.ext-row { border-bottom: 1px solid var(--ext-border); background: transparent; }
.ext-row[open] { background: var(--ext-surface); }
.ext-row > summary {
  display: grid;
  grid-template-columns: 10px minmax(100px, 1fr) minmax(112px, auto) 70px 10px;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 5px 8px;
  cursor: pointer;
  list-style: none;
}
.ext-row > summary::-webkit-details-marker { display: none; }
.ext-row > summary:hover { background: var(--ext-hover); }
.ext-mark { width: 8px; height: 8px; border-radius: 2px; background: var(--ext-muted); }
.ext-mark--failure, .ext-mark--incomplete { background: var(--ext-failure); }
.ext-mark--font-timing { background: var(--ext-font-timing); }
.ext-mark--external { background: var(--ext-external); }
.ext-mark--mocking { background: var(--ext-mocking); }
.ext-resource { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ext-narrow-label { display: none; }
.ext-row-tags { display: flex; align-items: center; gap: 4px; min-width: 0; }
.ext-tag { display: inline-block; padding: 2px 6px; border-radius: 3px; background: var(--ext-hover); font-size: 11px; white-space: nowrap; }
.ext-tag--failure, .ext-tag--incomplete { color: var(--ext-failure); }
.ext-tag--font-timing { color: var(--ext-font-timing); }
.ext-tag--external { color: var(--ext-external); }
.ext-tag--mocking { color: var(--ext-mocking); }
.ext-story-count { color: var(--ext-muted); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ext-row > summary::after { content: ''; display: block; width: 7px; height: 7px; border-right: 1.5px solid var(--ext-muted); border-bottom: 1.5px solid var(--ext-muted); transform: rotate(45deg); transition: transform 150ms ease-out; }
.ext-row[open] > summary::after { transform: rotate(225deg); }
.ext-detail { padding: 0 12px 13px 28px; color: var(--ext-text); line-height: 1.45; }
.ext-detail p { margin: 0 0 8px; }
.ext-detail h3 { margin: 0 0 5px; font-size: 12px; font-weight: 650; }
.ext-detail ul { margin: 0; padding-left: 18px; }
.ext-detail li + li { margin-top: 4px; }
.ext-detail a { color: var(--ext-link); text-underline-offset: 2px; }
.ext-detail code { font-family: var(--ext-code-font); overflow-wrap: anywhere; }
.ext-detail-grid { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr); gap: 24px; }
.ext-full-url { color: var(--ext-muted); overflow-wrap: anywhere; }
.ext-empty { max-width: 56ch; padding: 23px 8px; color: var(--ext-muted); line-height: 1.5; }
.ext-empty strong { display: block; margin-bottom: 3px; color: var(--ext-text); font-size: 13px; }
@container externalsss-panel (max-width: 760px) {
  .ext-filters { display: none; }
  .ext-filter-select { display: block; }
  .ext-row > summary { grid-template-columns: 10px minmax(80px, 1fr) 64px 10px; gap: 8px; }
  .ext-row-tags { display: none; }
  .ext-narrow-label { display: inline; color: var(--ext-muted); font-weight: 500; }
  .ext-detail-grid { grid-template-columns: 1fr; gap: 12px; }
}
@container externalsss-panel (max-width: 530px) {
  .ext-heading p { display: none; }
  .ext-header { gap: 8px; }
  .ext-actions { gap: 5px; }
  .ext-button { padding: 5px 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .ext-progress span, .ext-row > summary::after { transition: none; }
}
`;
