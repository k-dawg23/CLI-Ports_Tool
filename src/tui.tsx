import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import chalk from "chalk";
import { colorFramework, formatMemory } from "./format.js";
import { getListeningPorts, killPortProcess } from "./ports.js";
import type { PortProcess } from "./types.js";

const REFRESH_INTERVAL_MS = 3000;

export function PortsApp() {
  const { exit } = useApp();
  const [processes, setProcesses] = useState<PortProcess[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Loading listening ports...");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isRefreshing, setIsRefreshing] = useState(true);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      setIsRefreshing(true);
      try {
        const next = await getListeningPorts();
        if (!active) {
          return;
        }

        setProcesses(next);
        setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
        setStatusMessage(`Tracking ${next.length} listening port${next.length === 1 ? "" : "s"}. Auto-refresh every 3s.`);
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

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => Math.min(processes.length - 1, current + 1));
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    if (input === "r") {
      setStatusMessage("Refreshing now...");
      setIsRefreshing(true);
      void getListeningPorts()
        .then((next) => {
          setProcesses(next);
          setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
          setStatusMessage(`Tracking ${next.length} listening port${next.length === 1 ? "" : "s"}. Auto-refresh every 3s.`);
          setErrorMessage(undefined);
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Failed to refresh ports.");
        })
        .finally(() => {
          setIsRefreshing(false);
        });
      return;
    }

    if (input === "k") {
      const selected = processes[selectedIndex];
      if (!selected) {
        return;
      }

      setStatusMessage(`Killing PID ${selected.pid} on port ${selected.port}...`);
      void killPortProcess(selected.port)
        .then(async (result) => {
          setStatusMessage(result.message);
          const next = await getListeningPorts();
          setProcesses(next);
          setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(0, next.length - 1))));
        })
        .catch((error) => {
          setErrorMessage(error instanceof Error ? error.message : "Failed to kill process.");
        });
    }
  });

  const selected = processes[selectedIndex];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyanBright">ports v1.0.0</Text>
      <Text color={errorMessage ? "redBright" : "gray"}>
        {errorMessage ?? `${statusMessage}${isRefreshing ? " Refreshing..." : ""}`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <HeaderRow />
        {processes.length === 0 ? (
          <Text color="yellow">No listening TCP ports found.</Text>
        ) : (
          processes.map((process, index) => (
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
        <Text dimColor>Keys: ↑/↓ move  r refresh  k kill selected port  q quit</Text>
      </Box>
    </Box>
  );
}

function HeaderRow() {
  const columns = ["PORT", "PROJECT", "FRAMEWORK", "PID", "MEM", "UPTIME", "COMMAND"];
  const widths = [6, 22, 12, 8, 10, 12, 20];

  return (
    <Text bold>
      {columns.map((column, index) => column.padEnd(widths[index]!, " ")).join(" ")}
    </Text>
  );
}

function PortRow({ process, selected }: { process: PortProcess; selected: boolean }) {
  const cells = [
    String(process.port).padEnd(6, " "),
    trim(process.projectName, 22).padEnd(22, " "),
    trim(process.framework, 12).padEnd(12, " "),
    String(process.pid).padEnd(8, " "),
    formatMemory(process.memoryKb).padEnd(10, " "),
    (process.uptime ?? "-").padEnd(12, " "),
    trim(process.command, 20).padEnd(20, " ")
  ];

  return (
    <Text inverse={selected}>
      {selected ? ">" : " "}
      {cells[0]} {cells[1]} {colorFramework(cells[2].trim()).padEnd(12, " ")} {cells[3]} {cells[4]} {cells[5]} {cells[6]}
    </Text>
  );
}

function trim(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
