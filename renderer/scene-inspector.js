'use strict';
// Read-only scene inspector (Phase WD2-A).
//
// Shows the structured facts P4-A and P4-B leave behind for the selected
// scene item, plus a few facts facts the scene tree itself owns. NEVER maps
// a semantic code to severity (P4-A's job), NEVER maps a semantic code to
// prose (P4-B's job), NEVER parses source text. The view is a pure DOM
// binding over the read model and the message catalog.

(function () {
  const KIND = {
    DOCUMENT: 'Document',
    NODE: 'Node',
    USE: 'Use',
    PROTO: 'Proto',
    EXTERNPROTO: 'ExternProto',
    ROUTE: 'Route',
  };
  const USE_TARGET = { RESOLVED: 'resolved', UNRESOLVED: 'unresolved' };

  function emptyNote(text) {
    const n = document.createElement('div');
    n.className = 'empty-note';
    n.textContent = text;
    return n;
  }

  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function kv(table, label, value, opts) {
    if (value == null || value === '') return;
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    if (opts && opts.mono) td.className = 'mono';
    td.textContent = value;
    tr.appendChild(th); tr.appendChild(td);
    table.appendChild(tr);
  }

  // Render the inspector for `item` (or the appropriate empty state). The
  // `deps` argument is the read-model + message facade; this file never
  // imports them, so tests can stub it.
  function renderInspector(rootEl, item, deps) {
    clearChildren(rootEl);
    if (!deps || !deps.presentation || !deps.messages) {
      rootEl.appendChild(emptyNote('Inspector unavailable.'));
      return;
    }
    if (!item) {
      rootEl.appendChild(emptyNote('No selection. Choose an item in the scene tree.'));
      return;
    }

    const header = document.createElement('div');
    header.className = 'inspector-header kind-' + item.kind.toLowerCase();
    const title = document.createElement('div');
    title.className = 'inspector-title';
    title.textContent = titleFor(item);
    const kind = document.createElement('span');
    kind.className = 'inspector-kind';
    kind.textContent = item.kind;
    header.appendChild(title);
    header.appendChild(kind);
    rootEl.appendChild(header);

    const facts = document.createElement('table');
    facts.className = 'inspector-facts kv';
    renderFacts(facts, item);
    rootEl.appendChild(facts);

    // Diagnostics linked to the selected item.
    rootEl.appendChild(makeHeading('Diagnostics'));
    const findings = (deps.findingsFor || (() => []))(item);
    if (!findings.length) {
      rootEl.appendChild(emptyNote('No diagnostics for this item.'));
    } else {
      rootEl.appendChild(renderFindings(findings, deps));
    }
  }

  function titleFor(item) {
    switch (item.kind) {
      case KIND.NODE:
        return item.def ? `${item.nodeType} (DEF ${item.def})` : item.nodeType;
      case KIND.USE:
        return `USE ${item.useName || '?'}`;
      case KIND.PROTO:
        return `PROTO ${item.protoName || '?'}`;
      case KIND.EXTERNPROTO:
        return `EXTERNPROTO ${item.externprotoName || '?'}`;
      case KIND.ROUTE:
        return `ROUTE ${item.routeFromNode || '?'} → ${item.routeToNode || '?'}`;
      case KIND.DOCUMENT:
        return 'Document';
      default:
        return item.kind;
    }
  }

  function renderFacts(table, item) {
    switch (item.kind) {
      case KIND.NODE: {
        kv(table, 'Node type', item.nodeType, { mono: true });
        if (item.def) kv(table, 'DEF', item.def, { mono: true });
        if (item.protoInstance) kv(table, 'PROTO instance of', item.protoInstanceName, { mono: true });
        kv(table, 'Fields', String(item.fieldsCount));
        if (item.fieldNames && item.fieldNames.length) {
          kv(table, 'Field names', item.fieldNames.join(', '), { mono: true });
        }
        if (item.range) kv(table, 'Source range', rangeStr(item.range), { mono: true });
        break;
      }
      case KIND.USE: {
        kv(table, 'Name', item.useName, { mono: true });
        kv(table, 'Resolution', item.useTargetStatus);
        kv(table, 'Field', item.useFieldName || '(top-level)', { mono: true });
        if (item.range) kv(table, 'Source range', rangeStr(item.range), { mono: true });
        break;
      }
      case KIND.PROTO: {
        kv(table, 'Name', item.protoName, { mono: true });
        kv(table, 'Has body', item.protoHasBody ? 'yes' : 'no');
        kv(table, 'Interface members', String(item.protoInterfaceCount));
        if (item.range) kv(table, 'Source range', rangeStr(item.range), { mono: true });
        break;
      }
      case KIND.EXTERNPROTO: {
        kv(table, 'Name', item.externprotoName, { mono: true });
        kv(table, 'Interface members', String(item.externprotoInterfaceCount));
        if (item.range) kv(table, 'Source range', rangeStr(item.range), { mono: true });
        break;
      }
      case KIND.ROUTE: {
        kv(table, 'From', `${item.routeFromNode}.${item.routeFromEvent}`, { mono: true });
        kv(table, 'From resolved', item.routeResolvedFrom ? 'yes' : 'no');
        kv(table, 'To', `${item.routeToNode}.${item.routeToEvent}`, { mono: true });
        kv(table, 'To resolved', item.routeResolvedTo ? 'yes' : 'no');
        if (item.range) kv(table, 'Source range', rangeStr(item.range), { mono: true });
        break;
      }
      case KIND.DOCUMENT: {
        kv(table, 'Header', item.documentHasHeader ? 'yes' : 'no');
        kv(table, 'Statements', String(item.documentStatementCount));
        break;
      }
      default:
        break;
    }
  }

  function rangeStr(range) {
    if (!range) return '';
    return `${range.start.offset}–${range.end.offset} (L${range.start.line})`;
  }

  function makeHeading(text) {
    const h = document.createElement('h3');
    h.className = 'inspector-heading';
    h.textContent = text;
    return h;
  }

  // Render already-presented records directly. `findings` is the array of
  // `{finding, presentation}` records the editor binding hands in -- P4-A
  // already ordered and severity-classified them, and the inspector must
  // NOT call `presentDocumentFindings` a second time. Re-presenting would
  // throw EPRESENTATIONSHAPE (the records carry `presentation`, not the
  // raw-finding shape) and would also re-derive an order P4-A already
  // produced. The view paints severity chip colour and stops.
  function renderFindings(findings, deps) {
    const list = document.createElement('div');
    list.className = 'inspector-findings';
    for (const result of findings) {
      // result is `{finding, presentation}`. Defensive: a future caller
      // passing a raw finding would still work because P4-B accepts either
      // shape (the dispatcher reads `presentation.origin`); we just never
      // present twice here.
      const presentation = result && result.presentation;
      if (!presentation) continue;
      const text = deps.messages.messageForPresentation(result);
      const row = document.createElement('div');
      row.className = 'inspector-row sev-' + (presentation.severity || 'error');
      row.setAttribute('role', 'listitem');

      // Severity chip is the ONE place a styling choice lives; P4-A already
      // chose the severity value. The view only paints it.
      const chip = document.createElement('span');
      chip.className = 'inspector-chip';
      chip.textContent = severityLabel(presentation.severity);
      row.appendChild(chip);

      const body = document.createElement('div');
      body.className = 'inspector-body';

      const t = document.createElement('div');
      t.className = 'inspector-row-title';
      t.textContent = text.title;
      body.appendChild(t);

      const s = document.createElement('div');
      s.className = 'inspector-row-summary';
      s.textContent = text.summary;
      body.appendChild(s);

      if (text.detail) {
        const d = document.createElement('div');
        d.className = 'inspector-row-detail';
        d.textContent = text.detail;
        body.appendChild(d);
      }

      row.appendChild(body);
      list.appendChild(row);
    }
    return list;
  }

  // Human-readable severity label. Mapped from the SEVERITY value P4-A
  // emits -- this is presentation text, NOT severity selection.
  function severityLabel(sev) {
    if (sev === 'error') return 'Error';
    if (sev === 'warning') return 'Warning';
    if (sev === 'info') return 'Info';
    if (sev === 'hint') return 'Hint';
    return 'Issue';
  }

  function createInspector(rootEl, selection, deps) {
    let currentTree = null;
    let currentFindings = [];
    function render() {
      const id = selection.getSelection();
      // Look up the selected item via the scene-tree facade so we do not
      // depend on the (now read-only-proxied) `tree.byId` Map directly.
      const item = id && currentTree && deps.itemById
        ? deps.itemById(currentTree, id)
        : null;
      renderInspector(rootEl, item, {
        presentation: deps.presentation,
        messages: deps.messages,
        findingsFor: (item) => {
          if (!item || !currentTree || !deps.itemContainingOffset) return [];
          // Diagnostic ownership: each finding belongs to the SINGLE most-
          // specific scene item containing its range start. A finding inside
          // a nested Shape appears on the Shape -- not on the Shape's
          // enclosing Group, and not on the Document. This is the rule F3
          // exists to enforce: P4-A ordering is preserved, but the owner
          // filter is a one-item match, not an ancestor-containment match.
          return currentFindings.filter((p) => {
            const finding = p.finding;
            if (!finding || !finding.range) return false;
            const off = finding.range.start && finding.range.start.offset;
            if (off == null) return false;
            const owner = deps.itemContainingOffset(currentTree, off);
            return owner && owner.id === item.id;
          });
        },
      });
    }

    selection.subscribe(() => render());
    return {
      setSceneTree(tree) {
        currentTree = tree || null;
        render();
      },
      // Findings list comes from the editor binding; it is the
      // already-ordered presentation array. The inspector filters by
      // most-specific ownership.
      setFindings(findings) {
        currentFindings = Array.isArray(findings) ? findings : [];
        render();
      },
    };
  }

  const api = {
    KIND,
    USE_TARGET,
    createInspector,
    renderInspector,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.WRLForgeInspector = api;
  }
})();