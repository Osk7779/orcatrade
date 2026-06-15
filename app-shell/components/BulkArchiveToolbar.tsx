'use client';

// BulkArchiveToolbar — shared toolbar for the bulk-archive action on
// SoR list pages. Promoted from three byte-identical inline copies on
// the goods (PR #135), suppliers (PR #136), and shipments (PR #137)
// dashboard list pages.
//
// Promise tracker (PR #137): "A future PR can promote it to
// app-shell/components/ now that the contract is stable."
// PR #138 (this file) is that follow-up.
//
// Contract (kept identical to the three inline predecessors):
//   - Two-stage destructive action: first click on Archive →
//     'confirming' state; Confirm click → 'archiving' via the caller's
//     onConfirm callback
//   - Selection toolbar visible only when ≥1 row selected (the caller
//     is responsible for the {selectedCount > 0 && <BulkArchiveToolbar
//     ... />} gate)
//   - Button label adapts: "Archive N" / "Archiving…" / "Retry archive"
//   - Confirm banner copy: "Archive N? This is irreversible."
//   - Confirm button: critical-coloured (destructive-action cue)
//   - role="alert" failure summary appears in the 'error' state
//
// State machine ownership stays with the caller; this component is
// purely presentational. The caller's runBulkArchive() iterates the
// per-row DELETE pass; this component just renders the action buttons.

export type BulkArchiveState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'archiving' }
  | { kind: 'error'; failures: Map<string, string> };

export function BulkArchiveToolbar({
  selectedCount,
  archiveState,
  onArchiveClick,
  onConfirm,
  onCancel,
  onClear,
}: {
  selectedCount: number;
  archiveState: BulkArchiveState;
  onArchiveClick: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const archiving = archiveState.kind === 'archiving';
  const confirming = archiveState.kind === 'confirming';
  const hasErrors = archiveState.kind === 'error';

  return (
    <div className="border-b border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/20">
      <div className="px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/85">
          {selectedCount} selected
        </span>
        <div className="flex items-center gap-2">
          {!confirming && (
            <button
              type="button"
              onClick={onArchiveClick}
              disabled={archiving}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
              style={hasErrors ? { borderColor: 'var(--color-critical)', color: 'var(--color-critical)' } : undefined}
            >
              {archiving
                ? 'Archiving…'
                : hasErrors
                  ? 'Retry archive'
                  : `Archive ${selectedCount}`}
            </button>
          )}
          {confirming && (
            <>
              <span className="font-mono text-[11px] text-white/75">
                Archive {selectedCount}? This is irreversible.
              </span>
              <button
                type="button"
                onClick={onConfirm}
                className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5"
                style={{
                  backgroundColor: 'var(--color-critical)',
                  color: 'var(--color-ink)',
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/30 text-white/85 hover:text-white"
              >
                Cancel
              </button>
            </>
          )}
          {!confirming && (
            <button
              type="button"
              onClick={onClear}
              disabled={archiving}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/25 text-white/65 hover:text-white disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {hasErrors && (
        <div
          role="alert"
          className="px-6 pb-3 font-mono text-[11px]"
          style={{ color: 'var(--color-critical)' }}
        >
          {archiveState.failures.size} of {selectedCount} failed. See per-row errors below.
        </div>
      )}
    </div>
  );
}
