# CLI Ports Tool v2.0.1 — Release Execution Report

Date: 6 November 2026. **Status: BLOCKED after merge; v2.0.1 has NOT been tagged or published.**

Release execution stopped because required post-merge Windows verification failed. The user's release instructions explicitly require stopping and requesting renewed approval after a check fails following approval. No failing CI was bypassed, no automatic retry or corrective code change was made, and no tag/release was created.

## 1. Release summary

| Field | Result |
| --- | --- |
| Intended version | v2.0.1 |
| Repository | k-dawg23/CLI-Ports_Tool |
| Current local/remote branch | main |
| Approved implementation candidate | 4b5bdf39a7ec8268d0bad938deba154690adb7c6 |
| Merge commit | 87a349e81f2151654056567c7a1ca3d900e1e83e |
| Approved documentation-only release-head commit | 76ed2effb206fa923ff7bc70f9e93b43da4b6efc |
| Release tag object/target | NOT CREATED; no local or remote v2.0.1 tag |
| GitHub release URL | NONE; no GitHub release published |
| Final release recommendation | PENDING resolution and renewed approval |

PR #13 was merged only after the user replied "Please proceed" to the explicit pre-merge approval checkpoint. Immediately before merging, its head still matched the exact approved candidate, main still matched e57b85bf, all candidate/PR checks were green, GitHub reported CLEAN/MERGEABLE, and main had no active branch protection/rules. The merge command enforced the approved head with `--match-head-commit`; no admin override, force push or history rewrite was used.

The merge tree exactly matched the approved candidate tree (`331cce71a0ecf4b839efcfcbc8fe3b907e9c4035`), and the approved candidate remains an ancestor of main. The only subsequent commit changes two PROJECT_HISTORY.md lines: its release date and obsolete pending-verification sentence, as explicitly approved. Production source, dependencies, runtime version and ownership safeguards remain unchanged. Main, the manifest, lockfile and built CLI report 2.0.1.

The history date is prepared as 2026-11-06, but publication has not occurred. If release execution resumes on a later date, that bookkeeping must reflect the actual release date before tagging.

## 2. Pull request

- [PR #13](https://github.com/k-dawg23/CLI-Ports_Tool/pull/13): **Release v2.0.1 — Cross-platform correctness and verification**.
- Source: codex/v2.0.1-cross-platform-verification; target: main.
- Strategy: merge commit, consistent with repository history.
- Merged at 2026-11-06 15:00:07 UTC; resulting SHA recorded above.
- Exactly the nine approved commits and 60 files were reviewed. GitHub PR diff content matched the approved local diff; only optional HTML hunk-heading labels differed.
- Pre-merge [PR CI 42220720906](https://github.com/k-dawg23/CLI-Ports_Tool/actions/runs/42220720906): all four jobs passed.
- No branch-protection-required checks/reviews were configured. The project CI and user approval remained gates regardless; no protections were bypassed.

## 3. Verification results

### Original acceptance and successful pre-merge verification

The original RV-01 through RV-07 / AC-12 acceptance remains recorded against candidate 4b5bdf39 and [run 42216116120](https://github.com/k-dawg23/CLI-Ports_Tool/actions/runs/42216116120). The additional PR matrix passed before merging. Those historical passes do not replace the required current post-merge verification.

### Post-merge and final-main verification

| Run | Commit | Linux Node 24 | Linux Node 22.18.0 | macOS Node 24 | Windows Node 24 | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| [42238953525](https://github.com/k-dawg23/CLI-Ports_Tool/actions/runs/42238953525) | 87a349e | PASS — 127963885655 | PASS — 127963885725 | PASS — 127963885717 | FAIL — 127963885208 | FAIL |
| [42239114375](https://github.com/k-dawg23/CLI-Ports_Tool/actions/runs/42239114375) | 76ed2ef | PASS — 127964407514 | PASS — 127964407930 | PASS — 127964407548 | FAIL — 127964408191 | FAIL |

In both Windows jobs, installation, regression tests, type checking, build, built CLI integration and help/version passed. **The native smoke step failed on its first `node dist/cli.js list --json` invocation.** Later Windows native checks and ConPTY verification were not executed after that failure and must not be described as passing in these runs. Linux/macOS required checks and native terminal verification passed.

Both Windows failures report the test wrapper's Execa timeout at 15,000 ms, with no stdout or stderr:

- Merge run: duration approximately 15,024.976 ms.
- Final-main run: duration approximately 15,020.404 ms.

Their fresh native failure artifacts identify the correct respective SHA/run and record `native smoke: failed`. This is new, genuine post-merge verification evidence. No assumption of harmless CI flakiness or an application defect has been made.

### Confirmed failure and diagnostic interpretation

The confirmed failure is the **outer native-test command deadline** in `scripts/native-smoke.mjs:33`. The application independently has a 15-second active collection budget in `src/discovery.ts`. Using the same 15 seconds for the entire spawned CLI leaves no allowance for Node startup, scheduling, command cleanup and final output. That deadline layering is a plausible contributor and can prevent observing the application's own timeout/fallback diagnostics.

The current logs do not establish why the Windows invocation consumed that time or whether extending the outer deadline would produce a valid snapshot or an application diagnostic. The empty streams and outer termination cannot distinguish those possibilities. Further measurement is needed; no production correction is justified from these logs alone.

### Tag and publication verification

- Local and remote v2.0.1 absence rechecked: no tag exists.
- GitHub release list rechecked: no release exists.
- Tag creation/push, release publication, release assets and release-triggered CI: **NOT PERFORMED**.
- Existing workflow has push-triggered CI, including future tag pushes, but no automatic release publication/asset workflow was found. No custom release assets are documented as mandatory.

## 4. Release contents prepared on main

- Correct selected PID/port targeting and selection preservation, including shared-port listeners.
- Explicit required native discovery errors, best-effort enrichment, bounded/serialized collection, stale TUI data and persistent errors.
- Complete decimal port validation before backend side effects.
- Guarded process stopping/liveness outcomes and existing safe ownership checks.
- Editor/browser environment and foreground-lifetime preservation; Windows missing-executable classification.
- Cross-platform regression, integration and native discovery verification; Unix PTY and Windows ConPTY infrastructure.
- Version/current-release documentation updated to 2.0.1, with the explicitly approved release-history bookkeeping.

Reviewed GitHub release notes remain prepared at `docs/verification/release-execution-v2.0.1/release-notes-draft.md`. They distinguish package-declared Node compatibility from tested versions and retain user-facing PID-reuse/cache limitations. They have not been published.

## 5. Deviations, failures and retained evidence

- During PR preparation, the connected integration returned HTTP 403 for PR creation. The already-authenticated k-dawg23 GitHub CLI account successfully created the authorized PR; no branch policy was bypassed.
- One read-only release-list command initially requested unsupported CLI JSON field `url`; it was corrected to supported fields. It made no repository/release changes.
- Both post-merge Windows native runs failed as described above. Neither was retried automatically. No harness deadline, production budget, assertion or process-ownership rule has been changed after the failures.
- Untracked reports and evidence were preserved and excluded from commits. Only PROJECT_HISTORY.md was staged for the approved documentation commit.

Evidence is retained under `docs/verification/release-execution-v2.0.1/`: actual PR diff/inventory/check snapshots; merge-ci.json; main-ci.json; complete failed-step logs; merge-native-win32-failed.json; the final-main native failure artifact; and unapplied review drafts.

`native-cli-timeout-draft.patch` is a **proposal only**: make the test helper's timeout configurable and give spawned CLI invocations a 30-second outer observation window, while leaving other helper commands and the production active collection budget at 15 seconds. All existing native-success assertions and ownership safeguards remain required. The draft has not been applied or committed; it is not proof that the underlying Windows behavior is correct. Any application-level error exposed by this diagnostic window would remain a failure requiring investigation.

## 6. Remaining actions and approval requirement

Completed and verified: candidate/PR inspection, pre-merge approval, guarded merge, exact merge-tree/ancestry verification, approved two-line history commit and push, and inspection of both completed post-merge matrices.

Blocked: successful post-merge Windows native verification and therefore release readiness on current main.

Pending renewed approval: investigate the Windows runtime/deadline behavior; if justified, apply the narrowly scoped test-harness correction; run and inspect the complete matrix and native/terminal artifacts against the resulting exact release head. Preserve all production budgets and ownership protections. If a product defect is discovered, document it before proposing a separate correction.

Not performed: release tagging, tag push, GitHub release publication, post-publication verification or package-registry publication. No merge rollback or history rewrite has been attempted.

After the failure is resolved and approval renewed, recheck main/PR/tag/release state, establish a green exact release head, then resume the approved tag/publication workflow. Never overwrite an existing tag or silently substitute an unreviewed commit. **Do not claim release success from this report: v2.0.1 is merged but remains unpublished.**
