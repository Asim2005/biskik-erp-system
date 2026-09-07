import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import {
  IconArrowDown,
  IconClipboard,
  IconCopy,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';

/**
 * A spreadsheet-style editable grid.
 *
 * Keyboard:
 *   arrows / tab / enter      move
 *   shift + arrows            extend the selection
 *   type, F2, double click    edit
 *   enter                     commit and move down
 *   tab                       commit and move right
 *   escape                    cancel the edit
 *   delete / backspace        clear the selected range
 *   ctrl+c / ctrl+v           copy and paste TSV (works with Excel)
 *   ctrl+d                    fill the range down from the top row
 *   ctrl+enter                add a row below
 *
 * Columns:
 *   { key, title, width, type: 'text'|'number'|'select'|'computed',
 *     align, editable, options, precision, format, validate, min, max }
 */
export function ExcelGrid({
  columns,
  rows,
  onChange,
  onAddRow,
  minRows = 1,
  showTotals = true,
  emptyRow,
  readOnly = false,
  height,
}) {
  const [sel, setSel] = useState({ r: 0, c: firstEditable(columns) });
  const [anchor, setAnchor] = useState(null);
  const [editing, setEditing] = useState(null); // { r, c, value }
  const wrapRef = useRef(null);
  const editorRef = useRef(null);

  const editableCols = useMemo(
    () => columns.map((c, i) => ({ ...c, index: i })).filter((c) => c.type !== 'computed' && c.editable !== false),
    [columns]
  );

  function firstEditable(cols) {
    const i = cols.findIndex((c) => c.type !== 'computed' && c.editable !== false);
    return i === -1 ? 0 : i;
  }

  const range = useMemo(() => {
    if (!anchor) return { r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c };
    return {
      r1: Math.min(anchor.r, sel.r),
      r2: Math.max(anchor.r, sel.r),
      c1: Math.min(anchor.c, sel.c),
      c2: Math.max(anchor.c, sel.c),
    };
  }, [anchor, sel]);

  const inRange = (r, c) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus();
      if (editorRef.current.select) editorRef.current.select();
    }
  }, [editing]);

  /* ------------------------------ mutations ------------------------------ */

  const setCell = useCallback(
    (r, c, rawValue) => {
      const col = columns[c];
      if (!col || col.type === 'computed' || col.editable === false) return;
      const next = rows.map((row, i) => {
        if (i !== r) return row;
        let value = rawValue;
        if (col.type === 'number') {
          const parsed = parseFloat(String(rawValue).replace(/[,\s]/g, ''));
          value = Number.isFinite(parsed) ? parsed : rawValue === '' ? '' : row[col.key];
          if (typeof value === 'number') {
            if (col.min != null && value < col.min) value = col.min;
            if (col.max != null && value > col.max) value = col.max;
          }
        }
        const updated = { ...row, [col.key]: value };
        return col.onCellChange ? col.onCellChange(updated, value, row) : updated;
      });
      onChange(next);
    },
    [columns, rows, onChange]
  );

  const addRow = useCallback(
    (at) => {
      if (readOnly) return;
      const blank = typeof emptyRow === 'function' ? emptyRow() : { ...(emptyRow || {}) };
      const index = at == null ? rows.length : at + 1;
      const next = [...rows.slice(0, index), blank, ...rows.slice(index)];
      onChange(next);
      if (onAddRow) onAddRow(blank, index);
      setTimeout(() => setSel({ r: index, c: firstEditable(columns) }), 0);
    },
    [rows, onChange, emptyRow, onAddRow, columns, readOnly]
  );

  const removeRow = useCallback(
    (index) => {
      if (readOnly || rows.length <= minRows) return;
      onChange(rows.filter((_, i) => i !== index));
      setSel((s) => ({ ...s, r: Math.max(0, Math.min(s.r, rows.length - 2)) }));
    },
    [rows, onChange, minRows, readOnly]
  );

  const clearRange = useCallback(() => {
    if (readOnly) return;
    const next = rows.map((row, r) => {
      if (r < range.r1 || r > range.r2) return row;
      let updated = { ...row };
      for (let c = range.c1; c <= range.c2; c += 1) {
        const col = columns[c];
        if (!col || col.type === 'computed' || col.editable === false) continue;
        updated = { ...updated, [col.key]: col.type === 'number' ? 0 : '' };
        if (col.onCellChange) updated = col.onCellChange(updated, updated[col.key], row);
      }
      return updated;
    });
    onChange(next);
  }, [rows, columns, range, onChange, readOnly]);

  const fillDown = useCallback(() => {
    if (readOnly || range.r1 === range.r2) return;
    const source = rows[range.r1];
    const next = rows.map((row, r) => {
      if (r <= range.r1 || r > range.r2) return row;
      let updated = { ...row };
      for (let c = range.c1; c <= range.c2; c += 1) {
        const col = columns[c];
        if (!col || col.type === 'computed' || col.editable === false) continue;
        updated = { ...updated, [col.key]: source[col.key] };
        if (col.onCellChange) updated = col.onCellChange(updated, updated[col.key], row);
      }
      return updated;
    });
    onChange(next);
  }, [rows, columns, range, onChange, readOnly]);

  /* ------------------------- clipboard integration ----------------------- */

  const copyRange = useCallback(
    (event) => {
      const lines = [];
      for (let r = range.r1; r <= range.r2; r += 1) {
        const cells = [];
        for (let c = range.c1; c <= range.c2; c += 1) {
          const col = columns[c];
          const raw = col.type === 'computed' && col.compute ? col.compute(rows[r]) : rows[r]?.[col.key];
          cells.push(raw == null ? '' : String(raw));
        }
        lines.push(cells.join('\t'));
      }
      const text = lines.join('\n');
      if (event?.clipboardData) {
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
      }
    },
    [range, columns, rows]
  );

  const pasteText = useCallback(
    (text) => {
      if (readOnly || !text) return;
      const matrix = text
        .replace(/\r/g, '')
        .split('\n')
        .filter((line, i, arr) => line.length > 0 || i < arr.length - 1)
        .map((line) => line.split('\t'));
      if (!matrix.length) return;

      const startR = range.r1;
      const startC = range.c1;
      const needed = startR + matrix.length - rows.length;

      let next = [...rows];
      if (needed > 0) {
        const blanks = Array.from({ length: needed }, () =>
          typeof emptyRow === 'function' ? emptyRow() : { ...(emptyRow || {}) }
        );
        next = [...next, ...blanks];
      }

      matrix.forEach((line, dr) => {
        const r = startR + dr;
        let updated = { ...next[r] };
        line.forEach((cell, dc) => {
          const c = startC + dc;
          const col = columns[c];
          if (!col || col.type === 'computed' || col.editable === false) return;
          let value = cell.trim();
          if (col.type === 'number') {
            const parsed = parseFloat(value.replace(/[,\s]/g, ''));
            value = Number.isFinite(parsed) ? parsed : 0;
          }
          if (col.type === 'select' && col.options) {
            const hit = col.options.find(
              (o) => String(o.label).toLowerCase() === value.toLowerCase() || String(o.value) === value
            );
            value = hit ? hit.value : updated[col.key];
          }
          updated = { ...updated, [col.key]: value };
          if (col.onCellChange) updated = col.onCellChange(updated, value, next[r]);
        });
        next[r] = updated;
      });

      onChange(next);
      setSel({ r: Math.min(startR + matrix.length - 1, next.length - 1), c: startC });
      setAnchor(null);
    },
    [rows, columns, range, onChange, emptyRow, readOnly]
  );

  /* ------------------------------ navigation ----------------------------- */

  const move = useCallback(
    (dr, dc, extend = false) => {
      setSel((s) => {
        const r = Math.max(0, Math.min(rows.length - 1, s.r + dr));
        let c = s.c + dc;
        if (c < 0) c = 0;
        if (c > columns.length - 1) c = columns.length - 1;
        return { r, c };
      });
      if (!extend) setAnchor(null);
    },
    [rows.length, columns.length]
  );

  const moveToNextEditable = useCallback(
    (dir) => {
      setAnchor(null);
      setSel((s) => {
        const order = editableCols.map((c) => c.index);
        const pos = order.indexOf(s.c);
        const nextPos = pos + dir;
        if (nextPos >= 0 && nextPos < order.length) return { r: s.r, c: order[nextPos] };
        if (nextPos >= order.length) {
          return s.r < rows.length - 1 ? { r: s.r + 1, c: order[0] } : s;
        }
        return s.r > 0 ? { r: s.r - 1, c: order[order.length - 1] } : s;
      });
    },
    [editableCols, rows.length]
  );

  const beginEdit = useCallback(
    (r, c, seed) => {
      const col = columns[c];
      if (readOnly || !col || col.type === 'computed' || col.editable === false) return;
      const current = rows[r]?.[col.key];
      setEditing({ r, c, value: seed !== undefined ? seed : current == null ? '' : String(current) });
    },
    [columns, rows, readOnly]
  );

  const commitEdit = useCallback(
    (moveDir = 'down') => {
      if (!editing) return;
      setCell(editing.r, editing.c, editing.value);
      setEditing(null);
      if (moveDir === 'down') move(1, 0);
      if (moveDir === 'right') moveToNextEditable(1);
    },
    [editing, setCell, move, moveToNextEditable]
  );

  const handleKeyDown = (e) => {
    if (editing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit('down');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit('right');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(null);
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      fillDown();
      return;
    }
    if (ctrl && e.key === 'Enter') {
      e.preventDefault();
      addRow(sel.r);
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'c') {
      copyRange();
      return;
    }
    if (ctrl) return; // let the browser handle ctrl+v via the paste event

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.shiftKey && !anchor) setAnchor(sel);
        move(-1, 0, e.shiftKey);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (e.shiftKey && !anchor) setAnchor(sel);
        move(1, 0, e.shiftKey);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey && !anchor) setAnchor(sel);
        move(0, -1, e.shiftKey);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey && !anchor) setAnchor(sel);
        move(0, 1, e.shiftKey);
        break;
      case 'Tab':
        e.preventDefault();
        moveToNextEditable(e.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        e.preventDefault();
        beginEdit(sel.r, sel.c);
        break;
      case 'F2':
        e.preventDefault();
        beginEdit(sel.r, sel.c);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearRange();
        break;
      case 'Home':
        e.preventDefault();
        setSel({ r: sel.r, c: 0 });
        break;
      case 'End':
        e.preventDefault();
        setSel({ r: sel.r, c: columns.length - 1 });
        break;
      case 'PageDown':
        e.preventDefault();
        move(10, 0);
        break;
      case 'PageUp':
        e.preventDefault();
        move(-10, 0);
        break;
      default:
        if (e.key.length === 1 && !e.altKey) {
          e.preventDefault();
          beginEdit(sel.r, sel.c, e.key);
        }
    }
  };

  const handlePaste = (e) => {
    if (editing) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      pasteText(text);
    }
  };

  /* -------------------------------- render ------------------------------- */

  const totals = useMemo(() => {
    if (!showTotals) return null;
    const out = {};
    columns.forEach((col) => {
      if (!col.total) return;
      if (typeof col.total === 'function') {
        out[col.key] = col.total(rows);
      } else {
        out[col.key] = rows.reduce((s, row) => {
          const v = col.type === 'computed' && col.compute ? col.compute(row) : row[col.key];
          return s + (Number(v) || 0);
        }, 0);
      }
    });
    return out;
  }, [columns, rows, showTotals]);

  const renderValue = (row, col, r) => {
    const raw = col.type === 'computed' && col.compute ? col.compute(row, r) : row[col.key];
    if (col.type === 'select' && col.options) {
      const hit = col.options.find((o) => String(o.value) === String(raw));
      return hit ? hit.label : raw ?? '';
    }
    if (col.format) return col.format(raw, row, r);
    if (col.type === 'number' && raw !== '' && raw != null) {
      return Number(raw).toLocaleString('en-PK', {
        minimumFractionDigits: col.precision ?? 2,
        maximumFractionDigits: col.precision ?? 2,
      });
    }
    return raw ?? '';
  };

  return (
    <Box>
      <div
        className="xl-grid-wrap"
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCopy={copyRange}
        style={height ? { maxHeight: height } : undefined}
        data-lenis-prevent
      >
        <table className="xl-grid">
          <thead>
            <tr>
              <th className="xl-gutter">#</th>
              {columns.map((col) => (
                <th key={col.key} style={{ minWidth: col.width || 120, textAlign: col.align || 'left' }}>
                  {col.title}
                  {col.required ? <span style={{ color: 'var(--mantine-color-red-6)' }}> *</span> : null}
                </th>
              ))}
              {!readOnly && <th style={{ minWidth: 44 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.__key || r}>
                <td className="xl-gutter">{r + 1}</td>
                {columns.map((col, c) => {
                  const isSel = sel.r === r && sel.c === c;
                  const isEditing = editing && editing.r === r && editing.c === c;
                  const error = col.validate ? col.validate(row[col.key], row) : null;
                  const cls = [
                    isSel ? 'xl-selected' : '',
                    !isSel && inRange(r, c) ? 'xl-in-range' : '',
                    error ? 'xl-error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <td
                      key={col.key}
                      className={cls}
                      title={error || undefined}
                      onMouseDown={(e) => {
                        const targetTag = e.target.tagName;
                        if (isEditing || targetTag === 'INPUT' || targetTag === 'SELECT') {
                          return;
                        }
                        const isAlreadySel = sel.r === r && sel.c === c;
                        if (e.shiftKey) {
                          if (!anchor) setAnchor(sel);
                          setSel({ r, c });
                        } else {
                          setAnchor(null);
                          setSel({ r, c });
                        }
                        wrapRef.current?.focus();

                        if ((isAlreadySel || col.type === 'select') && !readOnly && col.type !== 'computed' && col.editable !== false) {
                          beginEdit(r, c);
                        }
                      }}
                      onDoubleClick={() => beginEdit(r, c)}
                    >
                      {isEditing ? (
                        col.type === 'select' ? (
                          <select
                            ref={editorRef}
                            className="xl-editor xl-select"
                            value={editing.value}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditing({ ...editing, value: val });
                              setCell(editing.r, editing.c, val);
                              setEditing(null);
                            }}
                            onBlur={() => commitEdit(null)}
                          >
                            <option value="">- Select -</option>
                            {col.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            ref={editorRef}
                            className={'xl-editor ' + (col.align === 'right' ? 'right' : '')}
                            value={editing.value}
                            inputMode={col.type === 'number' ? 'decimal' : undefined}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            onBlur={() => commitEdit(null)}
                          />
                        )
                      ) : (
                        <div
                          className={
                            'xl-cell ' +
                            (col.align === 'right' ? 'right ' : col.align === 'center' ? 'center ' : '') +
                            (col.type === 'computed' || col.editable === false || readOnly ? 'readonly' : '')
                          }
                        >
                          {renderValue(row, col, r)}
                        </div>
                      )}
                    </td>
                  );
                })}
                {!readOnly && (
                  <td>
                    <div className="xl-cell center">
                      <Tooltip label="Remove row">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          disabled={rows.length <= minRows}
                          onClick={() => removeRow(r)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {totals && rows.length > 0 && (
              <tr className="xl-total">
                <td className="xl-gutter" />
                {columns.map((col) => (
                  <td key={col.key}>
                    <div className={'xl-cell ' + (col.align === 'right' ? 'right' : '')}>
                      {totals[col.key] != null
                        ? Number(totals[col.key]).toLocaleString('en-PK', {
                            minimumFractionDigits: col.precision ?? 2,
                            maximumFractionDigits: col.precision ?? 2,
                          })
                        : col.totalLabel || ''}
                    </div>
                  </td>
                ))}
                {!readOnly && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <Group justify="space-between" mt="xs" wrap="wrap" gap="xs">
          <Group gap="xs">
            <ActionIcon variant="light" onClick={() => addRow()} aria-label="Add row">
              <IconPlus size={16} />
            </ActionIcon>
            <Tooltip label="Copy selection (Ctrl+C)">
              <ActionIcon variant="subtle" onClick={() => copyRange()}>
                <IconCopy size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Paste from Excel (Ctrl+V into the grid)">
              <ActionIcon
                variant="subtle"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    pasteText(text);
                  } catch {
                    /* clipboard permission denied - Ctrl+V still works */
                  }
                }}
              >
                <IconClipboard size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fill down (Ctrl+D)">
              <ActionIcon variant="subtle" onClick={fillDown}>
                <IconArrowDown size={16} />
              </ActionIcon>
            </Tooltip>
            <Text size="xs" c="dimmed">
              {rows.length} row{rows.length === 1 ? '' : 's'}
            </Text>
          </Group>

          <Text className="xl-hint" component="div">
            <kbd>Tab</kbd> next <kbd>Enter</kbd> edit <kbd>Ctrl</kbd>+<kbd>V</kbd> paste from Excel{' '}
            <kbd>Ctrl</kbd>+<kbd>D</kbd> fill down <kbd>Del</kbd> clear
          </Text>
        </Group>
      )}
    </Box>
  );
}
