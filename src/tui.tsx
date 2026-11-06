import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import chalk from "chalk";
import { colorFramework, colorMemory, formatMemory, isNodeLikeCommand, padAnsiEndVisible, padEndVisible, shouldDimProcess, TABLE_HEADERS, TABLE_WIDTHS, truncateVisible } from "./format.js";
import { portService, type PortService } from "./ports.js";
import { RefreshController, selectedIndex as resolveSelection, type Selection } from "./tui-state.js";
import type { ListenerTarget, PortProcess, PortSnapshot } from "./types.js";
import type { BackendActionResult } from "./backends/types.js";

import { APP_VERSION } from "./version.js";

const REFRESH_INTERVAL_MS = 3000;
const FILTER_MODES = ["all", "dev", "node"] as const;
const SORT_MODES = ["port", "memory", "uptime", "project"] as const;

type FilterMode = (typeof FILTER_MODES)[number];
type SortMode = (typeof SORT_MODES)[number];
type AppService = Pick<PortService, "snapshot" | "killTarget" | "openBrowser" | "openEditor">;

export function PortsApp({ service = portService }: { service?: AppService } = {}) {
  const { exit } = useApp();
  const [view, setView] = useState<{ snapshot?: PortSnapshot; error?: string; refreshing: boolean }>({ refreshing: true });
  const [selection, setSelection] = useState<Selection>({ index: 0 });
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("port");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; success?: boolean }>();
  const [actionWarnings, setActionWarnings] = useState<readonly string[]>([]);
  const active = useRef(false);
  const actionSequence = useRef(0);
  const pending = useRef(new Set<string>());
  const refresh = useRef<RefreshController>();

  useEffect(() => {
    active.current = true;
    const controller = new RefreshController(
      () => service.snapshot(),
      () => setView(current => ({ ...current, refreshing: true })),
      snapshot => { setView({ snapshot, refreshing: false }); setActionWarnings([]); },
      error => setView(current => ({ ...current, error: error instanceof Error ? error.message : "Failed to refresh ports." })),
      () => setView(current => ({ ...current, refreshing: false }))
    );
    refresh.current = controller;
    controller.request();
    const timer = setInterval(() => controller.request(), REFRESH_INTERVAL_MS);
    return () => { active.current = false; controller.dispose(); clearInterval(timer); };
  }, [service]);

  const activeSearchQuery = isSearchActive ? searchDraft : searchQuery;
  const visibleProcesses = sortProcesses(
    (view.snapshot?.processes ?? []).filter(row => matchesFilter(row, filterMode)).filter(row => matchesSearch(row, activeSearchQuery)), sortMode
  );
  const selectedIndex = resolveSelection(visibleProcesses, selection);
  const selected = visibleProcesses[selectedIndex];

  useEffect(() => {
    const target = selected ? { pid: selected.pid, port: selected.port } : undefined;
    setSelection(current => current.index === selectedIndex && current.target?.pid === target?.pid && current.target?.port === target?.port
      ? current : { index: selectedIndex, target });
  }, [selectedIndex, selected?.pid, selected?.port, selection.target?.pid, selection.target?.port]);

  const runAction = (kind: "kill" | "browser" | "editor", target: ListenerTarget) => {
    const captured = { pid: target.pid, port: target.port };
    const key = `${kind}:${captured.pid}:${captured.port}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    const sequence = ++actionSequence.current;
    setFeedback({ message: `${kind === "kill" ? "Stopping" : "Opening"} PID ${captured.pid} on port ${captured.port}...` });
    const onWarnings = (warnings: readonly string[]) => { if (active.current) setActionWarnings(warnings); };
    const operation = () => kind === "kill" ? service.killTarget(captured, onWarnings) : kind === "browser" ? service.openBrowser(captured, onWarnings) : service.openEditor(captured, onWarnings);
    void Promise.resolve().then(operation).then((result: BackendActionResult) => {
      if (!active.current) return;
      if (sequence === actionSequence.current) setFeedback(result);
      if (kind === "kill") refresh.current?.request();
    }, error => {
      if (active.current && sequence === actionSequence.current) setFeedback({ success: false, message: error instanceof Error ? error.message : "Action failed." });
    }).finally(() => pending.current.delete(key));
  };

  useInput((input, key) => {
    if (isSearchActive) {
      if (key.escape) {
        setIsSearchActive(false); setSearchDraft(""); setSearchQuery(""); setSelection({ index: 0 }); return;
      }
      if (key.return) {
        setIsSearchActive(false); setSearchQuery(searchDraft); setSelection({ index: 0 }); return;
      }
      if (key.backspace || key.delete) {
        setSearchDraft(current => current.slice(0, -1)); setSelection({ index: 0 }); return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearchDraft(current => current + input); setSelection({ index: 0 });
      }
      return;
    }
    if (key.upArrow || key.downArrow) {
      const index = Math.max(0, Math.min(visibleProcesses.length - 1, selectedIndex + (key.upArrow ? -1 : 1)));
      const row = visibleProcesses[index];
      setSelection({ index, target: row ? { pid: row.pid, port: row.port } : undefined }); return;
    }
    if (input === "/") { setIsSearchActive(true); setSearchDraft(searchQuery); setSelection({ index: 0 }); return; }
    if (input === "f") { setFilterMode(current => FILTER_MODES[(FILTER_MODES.indexOf(current) + 1) % FILTER_MODES.length]!); setSelection({ index: 0 }); return; }
    if (input === "s") { setSortMode(current => SORT_MODES[(SORT_MODES.indexOf(current) + 1) % SORT_MODES.length]!); return; }
    if (input === "q") { exit(); return; }
    if (input === "r") { refresh.current?.request(); return; }
    if (!selected) return;
    if (input === "K") runAction("kill", selected);
    if (input === "o") runAction("browser", selected);
    if (input === "e") runAction("editor", selected);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyanBright">ports v{APP_VERSION}  <Text color="yellowBright">[{getFilterLabel(filterMode)}]</Text> <Text color="greenBright">[{getSortLabel(sortMode)}]</Text></Text>
      <Text color={view.error ? "redBright" : "gray"}>
        {view.error
          ? `${view.snapshot ? `STALE · Last successful refresh ${new Date(view.snapshot.completedAt).toLocaleTimeString()} · ` : "Discovery unavailable · "}${view.error}`
          : view.snapshot ? `Tracking ${view.snapshot.processes.length} listening ports. Auto-refresh every 3s.${view.refreshing ? " Refreshing..." : ""}` : "Loading listening ports..."}
      </Text>
      {[...new Set([...(view.snapshot?.warnings ?? []), ...actionWarnings])].map(warning => <Text key={warning} color="yellow">{warning}</Text>)}
      {feedback ? <Text color={feedback.success === false ? "redBright" : feedback.success ? "green" : "gray"}>{feedback.message}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        <HeaderRow />
        {!view.snapshot ? <Text color="yellow">{view.error ? "Listening-port data is unavailable." : "Loading listening-port data..."}</Text>
          : visibleProcesses.length === 0 ? <Text color="yellow">No ports match the current filter.</Text>
          : visibleProcesses.map((row, index) => <PortRow key={`${row.pid}-${row.port}`} process={row} selected={index === selectedIndex} />)}
      </Box>
      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>{chalk.bold("Selected")}</Text>
        {selected ? <>
          <Text>Port {selected.port} · {selected.projectName} · PID {selected.pid}</Text>
          <Text>Framework {selected.framework} · Mem {formatMemory(selected.memoryKb)} · Uptime {selected.uptime ?? "-"}</Text>
          <Text dimColor>{selected.cwd ?? "No working directory detected"}</Text>
        </> : <Text dimColor>No process selected.</Text>}
      </Box>
      <Box marginTop={1}><ShortcutBar /></Box>
      {isSearchActive ? <Box marginTop={1} borderStyle="round" borderColor="cyanBright" paddingX={1}>
        <Text><Text color="cyanBright">/</Text> {searchDraft}<Text dimColor>{searchDraft ? "" : " search project, command, or port"}  Enter lock  Esc clear</Text></Text>
      </Box> : null}
    </Box>
  );
}

function HeaderRow() {
  return (
    <Text bold>
      {" "}
      {TABLE_HEADERS.map((column, index) => padEndVisible(column, TABLE_WIDTHS[index]!)).join(" ")}
    </Text>
  );
}

function PortRow({ process, selected }: { process: PortProcess; selected: boolean }) {
  const isDimmed = shouldDimProcess(process);
  const styleCell = (value: string) => (isDimmed && !selected ? chalk.dim(value) : value);
  const portCell = padEndVisible(String(process.port), TABLE_WIDTHS[0]);
  const projectCell = padEndVisible(process.projectName, TABLE_WIDTHS[1]);
  const frameworkValue = truncateVisible(process.framework, TABLE_WIDTHS[2]);
  const frameworkCell = isDimmed && !selected ? styleCell(frameworkValue) : colorFramework(frameworkValue);
  const visibleFramework = padAnsiEndVisible(frameworkCell, TABLE_WIDTHS[2]);
  const pidCell = padEndVisible(String(process.pid), TABLE_WIDTHS[3]);
  const memoryCell = padAnsiEndVisible(colorMemory(process.memoryKb), TABLE_WIDTHS[4]);
  const uptimeCell = padEndVisible(process.uptime ?? "-", TABLE_WIDTHS[5]);
  const commandCell = padEndVisible(process.command, TABLE_WIDTHS[6]);

  return (
    <Text inverse={selected}>
      {styleCell(`${selected ? ">" : " "}${portCell} `)}
      {styleCell(`${projectCell} `)}
      {visibleFramework}
      {styleCell(` ${pidCell} `)}
      {memoryCell}
      {styleCell(` ${uptimeCell} `)}
      {styleCell(commandCell)}
    </Text>
  );
}

function ShortcutBar() {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} gap={2}>
      <Shortcut color="whiteBright" keyLabel="↑/↓" label="Move" />
      <Shortcut color="cyanBright" keyLabel="/" label="Search" />
      <Shortcut color="yellowBright" keyLabel="f" label="Filter" />
      <Shortcut color="greenBright" keyLabel="s" label="Sort" />
      <Shortcut color="greenBright" keyLabel="K" label="Kill" />
      <Shortcut color="cyanBright" keyLabel="o" label="Open URL" />
      <Shortcut color="blueBright" keyLabel="e" label="Open Editor" />
      <Shortcut color="yellow" keyLabel="r" label="Refresh" />
      <Shortcut color="magentaBright" keyLabel="q" label="Quit" />
    </Box>
  );
}

function Shortcut({ color, keyLabel, label }: { color: string; keyLabel: string; label: string }) {
  return (
    <Text>
      <Text color={color}>[{keyLabel}]</Text> <Text dimColor>{label}</Text>
    </Text>
  );
}

function matchesFilter(process: PortProcess, filterMode: FilterMode): boolean {
  switch (filterMode) {
    case "dev":
      return process.port >= 3000 && process.port <= 9999;
    case "node":
      return process.framework !== "-" || isNodeLikeCommand(process.command);
    case "all":
    default:
      return true;
  }
}

function matchesSearch(process: PortProcess, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return (
    process.projectName.toLowerCase().includes(normalizedQuery) ||
    process.command.toLowerCase().includes(normalizedQuery) ||
    String(process.port).includes(normalizedQuery)
  );
}

export function sortProcesses(processes: readonly PortProcess[], sortMode: SortMode): PortProcess[] {
  return [...processes].sort((left, right) => {
    switch (sortMode) {
      case "memory":
        return compareNumbersDesc(left.memoryKb ?? 0, right.memoryKb ?? 0) || compareNumbersAsc(left.port, right.port);
      case "uptime":
        return compareNumbersDesc(parseElapsedToSeconds(left.uptime), parseElapsedToSeconds(right.uptime)) || compareNumbersAsc(left.port, right.port);
      case "project":
        return left.projectName.localeCompare(right.projectName) || compareNumbersAsc(left.port, right.port);
      case "port":
      default:
        return compareNumbersAsc(left.port, right.port);
    }
  });
}

function getFilterLabel(filterMode: FilterMode): string {
  switch (filterMode) {
    case "dev":
      return "dev ports";
    case "node":
      return "node only";
    case "all":
    default:
      return "all ports";
  }
}

function getSortLabel(sortMode: SortMode): string {
  switch (sortMode) {
    case "memory":
      return "memory desc";
    case "uptime":
      return "uptime desc";
    case "project":
      return "project a-z";
    case "port":
    default:
      return "port asc";
  }
}

function parseElapsedToSeconds(elapsed?: string): number {
  if (!elapsed) {
    return 0;
  }

  const trimmed = elapsed.trim();
  const daySplit = trimmed.split("-");
  const dayCount = daySplit.length === 2 ? Number.parseInt(daySplit[0] ?? "0", 10) : 0;
  const timePart = daySplit.length === 2 ? daySplit[1]! : daySplit[0]!;
  const parts = timePart.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return dayCount * 86400 + hours! * 3600 + minutes! * 60 + seconds!;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return dayCount * 86400 + minutes! * 60 + seconds!;
  }

  return dayCount * 86400;
}

function compareNumbersAsc(left: number, right: number): number {
  return left - right;
}

function compareNumbersDesc(left: number, right: number): number {
  return right - left;
}
