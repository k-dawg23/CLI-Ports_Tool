# CLI Ports Tool v2.0.1 — Release Execution Report

Date: 6 November 2026. **Status: TAGGED; GitHub release publication PAUSED after a macOS tag-run harness failure.**

The first pause followed post-merge Windows timeouts. After renewed user approval, a narrow test-only timeout/timing change passed the complete main matrix, and the annotated tag was created. The subsequent tag-triggered run failed in macOS PTY startup observation. Publication is paused again under the user's explicit stop-and-renew-approval rule. No failed CI was bypassed and no tag was moved or overwritten.

## 1. Release summary

| Field | Result |
| --- | --- |
| Intended version | v2.0.1 |
| Repository | k-dawg23/CLI-Ports_Tool |
| Current local/remote branch | main |
| Current verified release-head commit | 9ccdd9a6ec7daf13ff763071208cd1555cc5dfeb |
| Approved implementation candidate | 4b5bdf39a7ec8268d0bad938deba154690adb7c6 |
| Merge commit | 87a349e81f2151654056567c7a1ca3d900e1e83e |
| Approved documentation-only release-head commit | 76ed2effb206fa923ff7bc70f9e93b43da4b6efc |
| Annotated v2.0.1 tag object | f208c223e25fd97dc14d52f499a0001efcf8cb3a |
| Verified remote peeled tag target | 9ccdd9a6ec7daf13ff763071208cd1555cc5dfeb |
| GitHub release URL | NONE; no GitHub release published |
| Final release recommendation | PENDING resolution and renewed approval |

PR #13 was merged only after the user replied "Please proceed" to the explicit pre-merge approval checkpoint. Immediately before merging, its head still matched the exact approved candidate, main still matched e57b85bf, all candidate/PR checks were green, GitHub reported CLEAN/MERGEABLE, and main had no active branch protection/rules. The merge command enforced the approved head with `--match-head-commit`; no admin override, force push or history rewrite was used.

The merge tree exactly matched the approved candidate tree (`331cce71a0ecf4b839efcfcbc8fe3b907e9c4035`), and the approved candidate remains an ancestor of main. The first subsequent commit changes two PROJECT_HISTORY.md lines: its release date and obsolete pending-verification sentence, as explicitly approved. The later approved harness-only commit is recorded in the latest update. Production source, dependencies, runtime version and ownership safeguards remain unchanged. Main, the manifest, lockfile and built CLI report 2.0.1.

The history date is 2026-11-06, also the actual tag-creation date. GitHub release publication has not occurred; its eventual publication timestamp must be recorded separately without rewriting the existing tag.

## Latest execution update after renewed approval

The user authorized focused diagnosis, the proposed harness-only correction if justified, full CI and conditional release resumption. Commit `9ccdd9a6ec7daf13ff763071208cd1555cc5dfeb` changes only the native test wrapper: CLI invocations receive a 30-second overall observation window while the production active collection budget and other helper limits remain 15 seconds. It also retains per-command timing/output/status diagnostics. No production code or ownership rule changed.

[Corrected main run 42240885258](https://github.com/k-dawg23/CLI-Ports_Tool/actions/runs/42240885258) passed all four jobs on that exact SHA:

| Job | Job ID | Result |
| --- | --- | --- |
| Linux Node 24 | 127970546960 | PASS |
| Linux Node 22.18.0 | 127970546837 | PASS |
| macOS Node 24 | 127970547110 | PASS |
| Windows Node 24 | 127970546635 | PASS |

All regression, integration, native smoke and applicable PTY/ConPTY results/artifacts were inspected. Windows returned valid initial list JSON with exit 0 in 10,074 ms; subsequent CLI calls took approximately 2.4–2.5 seconds. These successful measurements do not prove why the earlier invocations exceeded 15 seconds; the unequal deadline correction addresses the observation-window design and retains diagnostics without masking application-level failures. The passing main artifacts are retained under `corrected-main-42240885258/`.

After main verification passed, remote main, version and tag/release absence were rechecked. Annotated tag `v2.0.1` was created and pushed without force. The remote tag object is `f208c223e25fd97dc14d52f499a0001efcf8cb3a` and its peeled target is `9ccdd9a6ec7daf13ff763071208cd1555cc5dfeb`, the verified main release commit. No feature or temporary test-merge commit was tagged.

### New tag-run failure and confirmed harness race

[Tag-push run 42241835709](https://github.com/k-dawg23/CLI-Ports_Tool/actions/runs/42241835709) tested the unchanged tagged SHA and completed with failure:

| Job | Job ID | Result |
| --- | --- | --- |
| Linux Node 22.18.0 | 127973820496 | PASS |
| Linux Node 24 | 127973820715 | PASS |
| macOS Node 24 | 127973820733 | FAIL — Unix PTY stage 2 startup assertion |
| Windows Node 24 | 127973820780 | PASS |

Windows native verification passed again; its initial list JSON completed successfully in 12,972 ms, with no stderr. The remaining commands completed in approximately 1.9 seconds. Thus the new blocker is distinct from the earlier Windows deadline failure.

The downloaded macOS experiment records **Stage 1 PASS; Stage 2 FAIL**. It fails at `assert.ok(observed.some(e => e.type === 'raw' && e.actual === true))` immediately after detecting the first TUI header. The same artifact's native observation log subsequently records PID 3128 successfully enabling real raw mode at timestamp 1793978375511, then exiting at 1793978375548 after the harness abort. Its terminal capabilities were genuine. Both listener fixtures exited normally through IPC disconnect, and the hosted CLI was reaped and PTY descriptors closed.

This demonstrates an infrastructure readiness race: initial rendering can precede Ink's raw-input effect and the sidecar snapshot. It is not evidence that the application cannot enable raw mode. The existing main run had completed the full interaction scenario on exactly this tagged commit. Nevertheless, the failed tag check is not ignored or relabeled passing; publication has stopped.

`raw-readiness-draft.patch` is an **unapplied proposal** for replacing the immediate startup snapshot with a bounded condition-based wait for the actual native raw-mode event, preserving the existing assertions. The same observation pattern exists in both Unix and Windows helpers, so the draft covers both. No tagged source has been edited. It must not be silently included by moving/replacing the existing tag.

Current release state: main and the tag still resolve to 9ccdd9a; tag is unchanged; GitHub release list remains empty. No publication attempt, tag deletion or tag rewrite occurred. Tag-run records, failed-step log, raw transcript, observation log and passing Windows native timings are retained under `tag-run-42241835709/`.

A possible next step requiring explicit renewed approval is one fresh full verification run against the **unchanged existing tag**, retaining this failed run and accepting publication only after all jobs genuinely pass with inspected artifacts. This adds evidence without moving a tag, modifying the candidate, weakening assertions or deleting failure records. The readiness-wait correction remains a separately reviewable future infrastructure change; it has not been applied merely to force the tagged run green.

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

### Initial post-merge verification failures (retained history)

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

- Initially absent; now annotated v2.0.1 exists and its remote target was verified as recorded in the latest update.
- GitHub release list rechecked: no release exists.
- Tag creation/push: **COMPLETED**. Tag-triggered CI: **FAILED on macOS as recorded above**. GitHub release publication, release assets and post-publication checks: **NOT PERFORMED**.
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
- Both initial post-merge Windows native runs failed as described above. Execution paused and renewed approval was obtained before the subsequent harness-only correction. Production budgets, assertions and process-ownership rules remain unchanged.
- Untracked reports and evidence were preserved and excluded from commits. Only PROJECT_HISTORY.md was staged for the approved documentation commit; only scripts/native-smoke.mjs was staged for the later approved harness commit.

Evidence is retained under `docs/verification/release-execution-v2.0.1/`: actual PR diff/inventory/check snapshots; merge-ci.json; main-ci.json; complete failed-step logs; merge-native-win32-failed.json; the final-main native failure artifact; and unapplied review drafts.

`native-cli-timeout-draft.patch` is a **proposal only**: make the test helper's timeout configurable and give spawned CLI invocations a 30-second outer observation window, while leaving other helper commands and the production active collection budget at 15 seconds. All existing native-success assertions and ownership safeguards remain required. The timeout draft was subsequently applied with diagnostic timing in 9ccdd9a after renewed approval; the complete corrected-main matrix passed. That does not retroactively establish the cause of earlier slow invocations. Any application-level error exposed by this diagnostic window would remain a failure requiring investigation.

## 6. Remaining actions and approval requirement

Completed and verified: original candidate and PR review; explicit approval; guarded merge and ancestry/tree checks; approved history commit; renewed approval after Windows failures; narrow test-only timeout/timing correction; successful complete main matrix; creation/push/remote verification of annotated v2.0.1; inspection of completed tag-run failure and native evidence.

Blocked: GitHub release publication following the newly failed macOS tag-run startup assertion.

Pending explicit renewed approval: choose and execute further verification on the immutable tag, preserving the failure evidence. A single fresh full run against v2.0.1 is proposed above. Do not move the tag or silently substitute a newer commit. If a readiness-wait correction is to be incorporated into later infrastructure, review its relationship to the already-tagged candidate explicitly.

Not performed: GitHub release publication, post-publication validation, package-registry publication, any tag deletion/rewrite or further code change after this new failure. No new retry has been launched.

All reports and evidence remain local/uncommitted and retained. Production code and accepted implementation findings remain unchanged. **Do not claim release success: v2.0.1 is merged and tagged, but the GitHub release remains unpublished pending renewed approval.**
