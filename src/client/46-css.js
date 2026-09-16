    ctx.effect(function () {
      return styles.insert(`
.gitops-chip{display:inline-flex;align-items:center;gap:6px;height:28px;max-width:200px;padding:0 10px;border:none;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer;flex:none}
.gitops-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-chip-open{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gitops-chip-repo{color:var(--dsw-alias-label-primary)}
.gitops-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.gitops-chip-idle{opacity:.72}
.gitops-badge{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:10px;line-height:1;flex:none}
.gitops-pop{position:absolute;left:8px;right:8px;bottom:100%;margin-bottom:8px;z-index:30;pointer-events:auto;box-sizing:border-box;height:74vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);color:var(--dsw-alias-label-primary);font-size:12px}
.gitops-top{display:flex;align-items:center;gap:8px;row-gap:6px;flex-wrap:wrap;flex:none;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);position:relative}
.gitops-tabs{display:flex;gap:2px;flex:none}
.gitops-tab{border:none;background:0 0;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;padding:3px 10px;border-radius:6px;cursor:pointer}
.gitops-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-tab-on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.gitops-title{font-weight:600;flex:none}
.gitops-dim{color:var(--dsw-alias-label-secondary)}
.gitops-body{flex:1;display:flex;min-height:0}
.gitops-side{width:200px;flex:none;overflow:auto;padding:4px 0;border-right:1px solid var(--dsw-alias-border-l1)}
.gitops-main{flex:1;min-width:0;display:flex;flex-direction:column}
.gitops-detail{width:280px;flex:none;overflow:auto;padding:6px 8px;border-left:1px solid var(--dsw-alias-border-l1)}
/* IDEA's log toolbar: a bordered search box, then the filters as inline
   "name: value" triggers that each clear themselves. Nothing else is a box, and
   there is no second filter row, so the graph keeps that height. */
.gitops-logsearch{display:inline-flex;align-items:center;gap:4px;flex:1 1 120px;min-width:80px;max-width:240px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-base)}
.gitops-logsearch:focus-within{border-color:var(--dsw-alias-brand-primary)}
.gitops-logsearch-ico{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}
.gitops-logsearch-input{flex:1 1 auto;width:auto;min-width:0;border:0;background:transparent;outline:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);padding:2px 0}
.gitops-logsearch-input::placeholder{color:var(--dsw-alias-label-secondary)}
.gitops-logsearch-x{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:1}
.gitops-logsearch-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gitops-tsep{flex:none;width:1px;height:14px;margin:0 3px;background:var(--dsw-alias-border-l1)}
.gitops-lf{display:inline-flex;align-items:center;gap:2px;flex:none;height:22px;padding:0 4px;border-radius:5px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gitops-lf:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-lf-on{color:var(--dsw-alias-brand-primary)}
.gitops-lf-k{flex:none;color:inherit;opacity:.85}
.gitops-lf-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;font-family:inherit;padding:0;flex:none;cursor:pointer;outline:none}
.gitops-lf-select option{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gitops-lf-caret{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary);pointer-events:none}
.gitops-lf-input{flex:0 0 auto;border:0;background:transparent;outline:none;font:inherit;font-size:11px;font-family:inherit;color:var(--dsw-alias-label-primary);padding:0}
.gitops-lf-input::placeholder{color:var(--dsw-alias-label-secondary)}
.gitops-lf-x{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;padding:0;border:0;border-radius:3px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:1}
.gitops-lf-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gitops-lclear{flex:none;padding:1px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.gitops-lclear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gitops-count{position:absolute;right:8px;top:5px;flex:none;font-size:11px;line-height:26px}
.gitops-log{flex:1;overflow:auto}
.gitops-trow{display:flex;align-items:center;gap:6px;padding:2px 6px 2px 0;cursor:pointer;white-space:nowrap;border-radius:4px;-webkit-user-select:none;user-select:none}
.gitops-trow:hover{background:var(--dsw-alias-bg-layer-2)}
.gitops-trow-sel{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-trow-sel:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* The branch the graph is currently scoped to. Distinct from the selection: the
   selection moves on a single click, this only moves on a double click. */
.gitops-trow-scope{box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.gitops-trow-scope .gitops-tname{color:var(--dsw-alias-brand-primary)}
.gitops-tw{flex:none;width:10px;color:var(--dsw-alias-label-secondary);font-size:9px;cursor:pointer}
.gitops-tname{overflow:hidden;text-overflow:ellipsis}
.gitops-tdim{margin-left:auto;padding-right:6px;color:var(--dsw-alias-label-secondary);font-size:11px}
.gitops-st{flex:none;width:12px;font-family:ui-monospace,monospace;font-weight:700}
.gitops-st-M{color:var(--dsw-alias-state-warn-primary)}
.gitops-st-A{color:var(--dsw-alias-state-success-primary)}
.gitops-st-D{color:var(--dsw-alias-state-error-primary)}
.gitops-st-R{color:var(--dsw-alias-brand-primary)}
.gitops-st-C{color:var(--dsw-alias-brand-primary)}
.gitops-st-U{color:var(--dsw-alias-state-error-primary)}
.gitops-cbox{flex:none;width:14px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gitops-cbox-on{color:var(--dsw-alias-brand-primary)}
.gitops-cbox-part{color:var(--dsw-alias-state-warn-primary)}
.gitops-changes{flex:1;display:flex;min-height:0}
.gitops-changes-tree{flex:1;min-width:0;overflow:auto;padding:4px 0}
.gitops-commitpane{width:304px;flex:none;border-left:1px solid var(--dsw-alias-border-l1);padding:8px;display:flex;flex-direction:column;gap:8px}
.gitops-crow{display:flex;align-items:center;gap:8px;height:26px;box-sizing:border-box;padding:0 8px;cursor:pointer;white-space:nowrap;-webkit-user-select:none;user-select:none}
.gitops-crow:hover{background:var(--dsw-alias-bg-layer-2)}
.gitops-crow-sel{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-subject{flex:1;overflow:hidden;text-overflow:ellipsis}
.gitops-author{flex:none;width:84px;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font-size:11px}
.gitops-date{flex:none;width:82px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:11px}
.gitops-refs{display:flex;gap:4px;flex:none;max-width:240px;overflow:hidden}
.gitops-ref{border-radius:999px;padding:0 6px;font-size:10px;line-height:16px;font-weight:600;white-space:nowrap}
.gitops-ref-head{background:var(--dsw-alias-brand-primary);color:#fff}
.gitops-ref-remote{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}
.gitops-ref-tag{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-border-l1)}
.gitops-logwrap{position:relative}
.gitops-graph{position:absolute;left:0;top:0;pointer-events:none}
.gitops-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;font-family:inherit;flex:none}
.gitops-btn:disabled{opacity:.45;cursor:default}
.gitops-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.gitops-clearable{position:relative;display:inline-flex;align-items:center;min-width:0;flex:1 1 auto}
.gitops-clearable-fixed{flex:0 0 auto}
.gitops-clearable-set{flex:1 1 160px;max-width:260px}
.gitops-clearable-path{flex:1 1 140px;min-width:110px}
.gitops-clearable-area{flex:0 0 auto;align-items:flex-start}
.gitops-clearable > input,.gitops-clearable > textarea{padding-right:22px}
.gitops-clear-x{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.gitops-clear-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gitops-clearable-area .gitops-clear-x{top:5px;transform:none}
.gitops-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:4px;padding:4px 6px;font-size:12px;font-family:inherit;width:100%}
textarea.gitops-input{resize:vertical}
.gitops-info{border-top:1px solid var(--dsw-alias-border-l1);margin-top:8px;padding-top:6px;display:flex;flex-direction:column;gap:3px}
.gitops-hash{font-family:ui-monospace,monospace;font-size:11px;word-break:break-all}
.gitops-msg{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px;white-space:pre-wrap;font-size:11px;max-height:120px;overflow:auto}
.gitops-error{color:var(--dsw-alias-state-error-primary)}
.gitops-ok{color:var(--dsw-alias-state-success-primary)}
.gitops-group-title{color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:2px 0}
.gitops-mono{font-family:ui-monospace,monospace}
.gitops-pane{padding:10px}
.gitops-setup{flex:1;display:flex;flex-direction:column;gap:10px;padding:16px 20px;overflow:auto}
.gitops-setup-h{font-size:14px;font-weight:600}
.gitops-setup-path{font-family:ui-monospace,monospace;font-size:12px;word-break:break-all;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px}
.gitops-setup-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gitops-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.gitops-danger{color:var(--dsw-alias-state-error-primary)}
.gitops-tools{position:relative;flex:none;display:flex;align-items:center;gap:3px;flex-wrap:wrap;padding:5px 80px 5px 7px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.gitops-tool{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;background:0 0;color:var(--dsw-alias-label-primary);border-radius:5px;padding:3px 7px;font-size:11px;font-family:inherit;cursor:pointer;flex:none;line-height:16px}
.gitops-tool:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gitops-tool:disabled{opacity:.4;cursor:default}
.gitops-tool-on{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1)}
.gitops-tool-ico{justify-content:center;width:26px;height:26px;padding:0}
.gitops-tool-badge{display:inline-grid;place-items:center;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:9px;line-height:1}
.gitops-sep{width:1px;height:16px;background:var(--dsw-alias-border-l1);flex:none;margin:0 3px}
.gitops-grow{flex:1;min-width:8px}
.gitops-banner{flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px}
.gitops-banner-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-warn-primary)}
.gitops-left{width:200px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1)}
.gitops-left .gitops-side{width:auto;flex:1;min-height:0;border-right:0}
.gitops-prompt{flex:none;display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.gitops-prompt .gitops-input{flex:1 1 auto;width:auto}
.gitops-grip{position:absolute;z-index:40;touch-action:none}
.gitops-grip-n{top:0;left:10px;right:10px;height:5px;cursor:ns-resize}
.gitops-grip-w{left:0;top:10px;bottom:10px;width:5px;cursor:ew-resize}
.gitops-grip-e{right:0;top:10px;bottom:10px;width:5px;cursor:ew-resize}
.gitops-grip-nw{left:0;top:0;width:12px;height:12px;cursor:nwse-resize}
.gitops-grip-ne{right:0;top:0;width:12px;height:12px;cursor:nesw-resize}
.gitops-grip:hover{background:var(--dsw-alias-brand-primary);opacity:.3}
.gitops-sync{display:flex;align-items:center;gap:2px;flex:none}
.gitops-branch-chip{display:inline-flex;align-items:center;gap:4px;max-width:220px;flex:none;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px}
.gitops-branch-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.gitops-ab{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px}
.gitops-repo-path{flex:1 1 140px;min-width:110px;width:auto}
.gitops-set{display:flex;flex-direction:column;gap:14px;padding:4px 2px;max-width:660px}
.gitops-set-h{font-size:14px;font-weight:600}
.gitops-set-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gitops-set-label{flex:none;min-width:170px;font-size:12px;color:var(--dsw-alias-label-primary)}
.gitops-set-input{flex:1 1 160px;width:auto;max-width:260px}
.gitops-set-num{flex:none;width:74px}
.gitops-set-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
.gitops-set-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.gitops-set-group{margin-top:6px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gitops-hidden{display:none}
/* Only while the header's switcher is open: the card hangs off the header and
   must be allowed past the panel's own clip, or a panel dragged short enough
   would cut the branch list in half. Nothing else overflows, so the rounded
   corners still look the same. */
.gitops-pop-overflow{overflow:visible}

/* ── branch switcher ──
   One card in two places: hanging under the panel header's chip, and floating
   above the composer when the chip is hovered. The layer wrapper generates no
   box, so the panel still positions itself against the slot's own container. */
.gitops-layer{display:contents}
.gitops-branch-wrap{position:relative;display:inline-flex;flex:none;max-width:220px}
.gitops-branch-chip{display:inline-flex;align-items:center;gap:4px;max-width:220px;flex:none;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;cursor:pointer;font-family:inherit}
.gitops-branch-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-branch-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.gitops-switch{position:absolute;z-index:40;width:456px;display:flex;flex-direction:column;overflow:visible;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft);color:var(--dsw-alias-label-primary);font-size:12px}
/* Hung off the header box, not off the chip: the header spans the whole panel, so
   the card starts at the panel's own left margin however the header wraps. It is
   also capped to that box, or a panel dragged to its 420px minimum would push the
   card past its own right edge. */
.gitops-switch-panel{top:calc(100% + 6px);left:8px;max-width:calc(100% - 16px)}
.gitops-switch-hover{left:8px;bottom:100%;margin-bottom:8px;max-width:calc(100% - 16px)}
.gitops-bs{display:flex;flex-direction:column;min-height:0;position:relative}
.gitops-bs-head{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:6px 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.gitops-bs-mag{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}
/* A borderless search line, the way a switcher's filter reads: the box itself
   would compete with the list for attention. */
.gitops-bs-search{flex:1 1 120px;width:auto;min-width:84px;border:0;background:transparent;outline:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);padding:2px 0}
.gitops-bs-search::placeholder{color:var(--dsw-alias-label-secondary)}
.gitops-bs-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gitops-bs-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* The repository-wide actions are chips on the search line, not rows inside the
   list: they cost no vertical space that way, and they stay reachable while the
   branch tree is scrolled. */
.gitops-bs-head-acts{display:flex;align-items:center;flex-wrap:wrap;gap:4px;flex:none}
.gitops-bs-chip{display:inline-flex;align-items:center;gap:3px;height:20px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:1;cursor:pointer;white-space:nowrap}
.gitops-bs-chip:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.gitops-bs-chip-on{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}
.gitops-bs-chip:disabled{opacity:.45;cursor:default}
.gitops-bs-chip .gitops-bs-ico{width:12px}
.gitops-bs-chip .gitops-bs-name{flex:0 1 auto;max-width:120px}
.gitops-bs-chip .gitops-bs-ab{font-size:10px}
.gitops-bs-chip-new{border-style:dashed}
.gitops-bs-sort{margin-left:auto}
.gitops-bs-list{position:relative;max-height:330px;overflow:auto;padding:4px 4px 6px}
.gitops-bs-row{display:flex;align-items:center;gap:7px;min-height:30px;padding:3px 8px 3px 4px;border-radius:6px;cursor:pointer;border:0;background:transparent;font:inherit;font-size:12px;color:inherit;text-align:left;width:100%;box-sizing:border-box}
.gitops-bs-row-on{background:var(--dsw-alias-interactive-bg-hover)}
/* the row the open submenu belongs to */
.gitops-bs-row-fly{background:var(--dsw-alias-interactive-bg-hover)}
.gitops-bs-row-cur .gitops-bs-name{font-weight:600}
.gitops-bs-busy{opacity:.6}
.gitops-bs-ico{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;color:var(--dsw-alias-brand-primary)}
.gitops-bs-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitops-bs-up{flex:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gitops-bs-ab{flex:none;font-size:11px;color:var(--dsw-alias-brand-primary)}
.gitops-bs-star{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-border-l1);cursor:pointer}
.gitops-bs-row:hover .gitops-bs-star{color:var(--dsw-alias-label-secondary)}
.gitops-bs-star-on,.gitops-bs-row:hover .gitops-bs-star-on{color:var(--dsw-alias-state-warn-primary)}
.gitops-bs-more{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-border-l1);cursor:pointer}
.gitops-bs-row:hover .gitops-bs-more{color:var(--dsw-alias-label-secondary)}
.gitops-bs-group{display:flex;align-items:center;gap:5px;padding:8px 8px 3px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.gitops-bs-caret{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px}
.gitops-bs-count{flex:none;color:var(--dsw-alias-border-l2)}
/* IDEA's branch submenu: hovering a row opens its actions to the right of the
   tree. The card is only 420px wide, so the flyout hangs past its edge, the way
   the real one hangs over the editor; the card therefore no longer clips. */
.gitops-bs-fly{position:absolute;left:calc(100% - 6px);z-index:6;width:198px;padding:4px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft)}
.gitops-bs-fly-head{display:flex;align-items:center;gap:5px;padding:3px 8px 6px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gitops-bs-fly-sep{height:1px;margin:3px 6px;background:var(--dsw-alias-border-l1)}
.gitops-bs-fly-item{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:16px;text-align:left;cursor:pointer}
.gitops-bs-fly-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gitops-bs-fly-item:disabled{opacity:.45;cursor:default}
.gitops-bs-fly-danger{color:var(--dsw-alias-state-error-primary)}
.gitops-bs-fly-ico{display:inline-flex;flex:none;width:14px;color:var(--dsw-alias-label-secondary)}
.gitops-bs-fly-key{flex:none;margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary)}
.gitops-bs-empty{padding:8px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gitops-bs-foot{display:flex;flex-direction:column;gap:6px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.gitops-bs-create{display:flex;align-items:center;gap:6px;padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.gitops-bs-new{flex:1 1 auto;width:auto;min-width:0}
.gitops-bs-check{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gitops-bs-rescue{align-self:flex-start;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-state-warn-primary);background:transparent;color:var(--dsw-alias-state-warn-primary);font:inherit;font-size:11px;cursor:pointer}
.gitops-warn{color:var(--dsw-alias-state-warn-primary)}
`)
    }, 'gitops panel styles')

