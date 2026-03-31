import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import chalk from "chalk";
import { colorFramework, colorMemory, formatMemory, isNodeLikeCommand, padAnsiEndVisible, padEndVisible, shouldDimProcess, TABLE_HEADERS, TABLE_WIDTHS, truncateVisible } from "./format.js";
import { getListeningPorts, killPortProcess, openPortInBrowser, openProjectInEditor } from "./ports.js";
import type { PortProcess } from "./types.js";

const REFRESH_INTERVAL_MS = 3000;
const APP_VERSION = "1.0.7";
const FILTER_MODES = ["all", "dev", "node"] as const;
const SORT_MODES = ["port", "memory", "uptime", "project"] as const;

type FilterMode = (typeof FILTER_MODES)[number];
type SortMode = (typeof SORT_MODES)[number];

export function PortsApp() {
  const { exit } = useApp();
  const [processes, setProcesses] = useState<PortProcess[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("port");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Loading listening ports...");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isRefreshing, setIsRefreshing] = useState(true);

  const refreshProcesses = async (message?: string) => {
    setIsRefreshing(true);

    try {
      const next = await getListeningPorts();
      setProcesses(next);
      setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
      setStatusMessage(message ?? `Tracking ${next.length} listening port${next.length === 1 ? "" : "s"}. Auto-refresh every 3s.`);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh ports.");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;

    const refresh = async (message?: string) => {
      setIsRefreshing(true);
      try {
        const next = await getListeningPorts();
        if (!active) {
          return;
        }

        setProcesses(next);
        setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
        setStatusMessage(message ?? `Tracking ${next.length} listening port${next.length === 1 ? "" : "s"}. Auto-refresh every 3s.`);
        setErrorMessage(undefined);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "Failed to refresh ports.");
      } finally {
        if (active) {
          setIsRefreshing(false);
        }
      }
    };

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const activeSearchQuery = isSearchActive ? searchDraft : searchQuery;
  const visibleProcesses = sortProcesses(
    processes
      .filter((process) => matchesFilter(process, filterMode))
      .filter((process) => matchesSearch(process, activeSearchQuery)),
    sortMode
  );
  const selected = visibleProcesses[selectedIndex];

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(0, visibleProcesses.length - 1))));
  }, [visibleProcesses.length]);

  useInput((input, key) => {
    if (isSearchActive) {
      if (key.escape) {
        setIsSearchActive(false);
        setSearchDraft("");
        setSearchQuery("");
        setSelectedIndex(0);
        setStatusMessage("Search cleared.");
        setErrorMessage(undefined);
        return;
      }

      if (key.return) {
        setIsSearchActive(false);
        setSearchQuery(searchDraft);
        setSelectedIndex(0);
        setStatusMessage(searchDraft.trim() ? `Search locked: ${searchDraft}` : "Search cleared.");
        setErrorMessage(undefined);
        return;
      }

      if (key.backspace || key.delete) {
        setSearchDraft((current) => current.slice(0, -1));
        setSelectedIndex(0);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setSearchDraft((current) => current + input);
        setSelectedIndex(0);
      }

      return;
    }

    const currentVisible = sortProcesses(
      processes
        .filter((process) => matchesFilter(process, filterMode))
        .filter((process) => matchesSearch(process, activeSearchQuery)),
      sortMode
    );
    const currentSelected = currentVisible[selectedIndex];

    if (key.upArrow) {
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => Math.min(currentVisible.length - 1, current + 1));
      return;
    }

    if (input === "/") {
      setIsSearchActive(true);
      setSearchDraft(searchQuery);
      setSelectedIndex(0);
      setStatusMessage("Search by project, command, or port.");
      setErrorMessage(undefined);
      return;
    }

    if (input === "f") {
      setFilterMode((current) => {
        const next = FILTER_MODES[(FILTER_MODES.indexOf(current) + 1) % FILTER_MODES.length]!;
        setSelectedIndex(0);
        setStatusMessage(`Filter set to ${getFilterLabel(next)}.`);
        setErrorMessage(undefined);
        return next;
      });
      return;
    }

    if (input === "s") {
      setSortMode((current) => {
        const next = SORT_MODES[(SORT_MODES.indexOf(current) + 1) % SORT_MODES.length]!;
        setStatusMessage(`Sort set to ${getSortLabel(next)}.`);
        setErrorMessage(undefined);
        return next;
      });
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    if (input === "r") {
      setStatusMessage("Refreshing now...");
      void refreshProcesses("Refreshed listening ports.");
      return;
    }

    if (input === "K") {
      if (!currentSelected) {
        return;
      }

      setStatusMessage(`Stopping PID ${currentSelected.pid} on port ${currentSelected.port}...`);
      void killPortProcess(currentSelected.port)
        .then(async (result) => {
          await refreshProcesses(result.message);
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Failed to kill process.");
        });
      return;
    }

    if (input === "o") {
      if (!currentSelected) {
        return;
      }

      setStatusMessage(`Opening localhost:${currentSelected.port} in your browser...`);
      void openPortInBrowser(currentSelected.port)
        .then((result) => {
          if (result.success) {
            setStatusMessage(result.message);
            setErrorMessage(undefined);
            return;
          }

          setErrorMessage(result.message);
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Failed to open the browser.");
        });
      return;
    }

    if (input === "e") {
      if (!currentSelected) {
        return;
      }

      setStatusMessage(`Opening ${currentSelected.projectName} in VS Code...`);
      void openProjectInEditor(currentSelected.port)
        .then((result) => {
          if (result.success) {
            setStatusMessage(result.message);
            setErrorMessage(undefined);
            return;
          }

          setErrorMessage(result.message);
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Failed to open VS Code.");
        });
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyanBright">
        ports v{APP_VERSION}  <Text color="yellowBright">[{getFilterLabel(filterMode)}]</Text> <Text color="greenBright">[{getSortLabel(sortMode)}]</Text>
      </Text>
      <Text color={errorMessage ? "redBright" : "gray"}>
        {errorMessage ?? `${statusMessage}${isRefreshing ? " Refreshing..." : ""}`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <HeaderRow />
        {visibleProcesses.length === 0 ? (
          <Text color="yellow">No ports match the current filter.</Text>
        ) : (
          visibleProcesses.map((process, index) => (
            <PortRow
              key={`${process.pid}-${process.port}`}
              process={process}
              selected={index === selectedIndex}
            />
          ))
        )}
      </Box>
      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>{chalk.bold("Selected")}</Text>
        {selected ? (
          <>
            <Text>Port {selected.port} · {selected.projectName} · PID {selected.pid}</Text>
            <Text>Framework {selected.framework} · Mem {formatMemory(selected.memoryKb)} · Uptime {selected.uptime ?? "-"}</Text>
            <Text dimColor>{selected.cwd ?? "No working directory detected"}</Text>
          </>
        ) : (
          <Text dimColor>No process selected.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <ShortcutBar />
      </Box>
      {isSearchActive ? (
        <Box marginTop={1} borderStyle="round" borderColor="cyanBright" paddingX={1}>
          <Text>
            <Text color="cyanBright">/</Text> {searchDraft}
            <Text dimColor>{searchDraft ? "" : " search project, command, or port"}</Text>
            <Text dimColor>  Enter lock  Esc clear</Text>
          </Text>
        </Box>
      ) : null}
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
      <Shortcut color="blueBright" keyLabel="e" label="Open in Code" />
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

function sortProcesses(processes: PortProcess[], sortMode: SortMode): PortProcess[] {
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
