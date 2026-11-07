## Fixes

- Target the selected PID/port for TUI actions and preserve selection through refreshes and sorting, including shared-port listeners.
- Report required native discovery failures instead of treating them as empty results or free ports. Retain stale TUI data with clear errors and keep optional metadata best effort.
- Reject incomplete or malformed port arguments before backend work.
- Preserve editor/browser launcher environments and foreground-editor lifetime. Improve Windows missing-executable diagnostics.

## Verification

- Regression, built CLI integration, type checking and builds passed on Linux, macOS and Windows.
- Native listener discovery, free-port checks and guarded owned-process termination passed.
- Interactive Linux/macOS Unix PTY and Windows ConPTY checks passed, including refresh, selection, harmless launcher shortcuts and normal cleanup.
- RV-01 through RV-07 and AC-12 passed for the approved implementation candidate.

## Compatibility

- Supports Linux, macOS and Windows. Unix discovery requires lsof; Windows uses native PowerShell discovery.
- Package Node requirement: `^22.18.0 || ^24.11.0 || >=26.0.0`. Release verification exercised Node 22.18.0 on Linux and supported Node 24 releases on all three operating systems; Node 26+ was not part of this release's CI matrix.
- Existing commands and successful JSON output remain compatible. Invalid port input now fails strictly; incomplete or unverifiable stops return a failure diagnostic.

## Limitations

Process actions revalidate PID/port, but operating-system PID-reuse races remain possible. Cached process-directory metadata can also become stale across undetected PID reuse.
