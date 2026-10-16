/** Quiet paper palette shared with the BiRead book mark. */
export const readerTheme = `
#zpt-bilingual { background:#ffffff; color:#3b3b3b; }
#zpt-bilingual .bi-controls { background:#ffffff; border-bottom:1px solid #e5e5e5; padding:12px 22px 9px; gap:9px; flex-shrink:0; }
#zpt-bilingual .bi-toolbar-primary { gap:12px; min-height:32px; }
#zpt-bilingual .bi-brand { display:flex; align-items:center; gap:8px; font:600 18px/1.2 system-ui; letter-spacing:-.5px; }
#zpt-bilingual .bi-brand svg { width:28px; height:28px; }
#zpt-bilingual .bi-mode-row { border:0; padding:0; gap:8px; flex-wrap:wrap; flex-shrink:0; }
#zpt-bilingual .bi-mode-label { display:none; }
#zpt-bilingual .bi-mode-switch { min-width:140px; background:#f7f4ee; border-color:#c9b89a; }
#zpt-bilingual button, #zpt-bilingual select { background:#ffffff; border:1px solid #dddddd; border-radius:7px; padding:6px 10px; min-height:32px; font:12px/1.4 system-ui; color:#494239; transition:background .12s; }
#zpt-bilingual button:hover, #zpt-bilingual select:hover { background:#eee4d4; border-color:#b9a68a; }
#zpt-bilingual button:focus-visible, #zpt-bilingual select:focus-visible { outline:2px solid #927858; outline-offset:2px; }
#zpt-bilingual button:disabled, #zpt-bilingual select:disabled { opacity:.45; cursor:default; }
#zpt-bilingual .bi-collapse-settings { margin-left:auto; background:transparent!important; color:#635644!important; border-color:#c9b89a!important; font-weight:500!important; }
#zpt-bilingual .bi-settings { background:#ffffff; border:1px solid #e0d6c6; border-radius:9px; padding:12px; gap:10px; }
#zpt-bilingual .bi-status { flex:0 0 auto; display:block; color:#746958; font:12px/1.5 system-ui; opacity:1; overflow-wrap:anywhere; }
#zpt-bilingual .bi-status:empty { display:none; }
#zpt-bilingual .bi-list { padding:24px 28px 72px; }
#zpt-bilingual .bi-row { max-width:1280px; border-bottom:1px solid #eeeeee; padding:22px 0; }
#zpt-bilingual .bi-translation { border-left-color:#e5dccf; }
#zpt-bilingual .bi-meta { color:#8a7e6d; opacity:1; font-size:11px; padding-bottom:10px; }
#zpt-bilingual .bi-meta button { border-color:transparent; background:transparent; color:#8a7e6d; min-height:26px; padding:3px 7px; font-size:11px; }
#zpt-bilingual .bi-meta button:hover { background:#f0e7d9; color:#4b4033; }
#zpt-bilingual:not([data-reading-mode=compare]) .bi-row[data-kind=title] .bi-text { text-align:left; font-size:1.6em; line-height:1.45; letter-spacing:-.02em; }
#zpt-bilingual:not([data-reading-mode=compare]) .bi-row[data-kind=footnote] { background:#fafafa; border-left:3px solid #c9b89a; padding:14px 0; margin-top:16px; }
#zpt-bilingual .bi-inspector { background:#ffffff; border-top:1px solid #e5e5e5; }
#zpt-bilingual textarea { background:#ffffff; border:1px solid #dddddd; border-radius:7px; padding:10px; }
#zpt-bilingual .bi-outline { max-width:230px; }
#zpt-bilingual:not([data-reading-mode=compare]) .bi-row:is([data-kind=author-info],[data-kind=publication-info],[data-kind=caption],[data-kind=reference]) { background:#fafafa; border-left:3px solid #d5c6af; padding:14px 0; margin-top:12px; }
#zpt-bilingual:not([data-reading-mode=compare]) .bi-row:is([data-kind=author-info],[data-kind=publication-info],[data-kind=caption],[data-kind=reference],[data-kind=footnote]) .bi-meta > span { background:#f1eee8; border-radius:4px; padding:3px 7px; color:#655b4e; font-weight:600; }
#zpt-bilingual:not([data-reading-mode=compare]) .bi-row:is([data-kind=author-info],[data-kind=publication-info],[data-kind=reference]) .bi-text { font-size:.9em; line-height:1.65; font-weight:400; }
#zpt-bilingual .bi-row[data-original-equation=true] > .bi-columns { display:none; }
@media(max-width:700px) {
 #zpt-bilingual .bi-controls { padding:9px 12px; }
 #zpt-bilingual .bi-list { padding:14px 10px 50px; }
 #zpt-bilingual .bi-text { padding-left:12px; padding-right:12px; }
 #zpt-bilingual .bi-mode-row select { max-width:100%; }
}
`;
