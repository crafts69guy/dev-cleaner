import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";

import { formatBytes } from "../lib/format";
import { readCleanupHistory } from "../storage";
import type { CleanupRun } from "../types";

function reportText(run: CleanupRun): string {
  const succeeded = run.items.filter((item) => item.status === "cleaned");
  const failed = run.items.filter((item) => item.status === "failed");
  const cancelled = run.items.filter((item) => item.status === "cancelled");
  const reclaimed = run.items.reduce((sum, item) => sum + (item.bytesReclaimed ?? 0), 0);
  return [
    `# Cleanup Report`,
    "",
    `Started: ${new Date(run.startedAt).toLocaleString()}`,
    `Completed: ${new Date(run.completedAt).toLocaleString()}`,
    `Succeeded: ${succeeded.length}`,
    `Failed: ${failed.length}`,
    `Cancelled: ${cancelled.length}`,
    `Measured disk space reclaimed: ${formatBytes(reclaimed)}`,
    "",
    ...run.items.map(
      (item) =>
        `- ${item.status === "cleaned" ? "✓" : item.status === "cancelled" ? "–" : "✗"} ${item.title} (${item.providerId}, footprint ${formatBytes(item.bytes)}, reclaimed ${formatBytes(item.bytesReclaimed)}): ${item.message ?? "No details"}`,
    ),
  ].join("\n");
}

export function CleanupReport({ run, onRetry }: { run: CleanupRun; onRetry?: () => void }) {
  const groups = useMemo(
    () => ({
      cleaned: run.items.filter((item) => item.status === "cleaned"),
      failed: run.items.filter((item) => item.status === "failed"),
      cancelled: run.items.filter((item) => item.status === "cancelled"),
    }),
    [run],
  );
  const report = reportText(run);

  return (
    <List navigationTitle="Cleanup Report" searchBarPlaceholder="Search cleanup results">
      <List.EmptyView title="No cleanup results" />
      {(["failed", "cancelled", "cleaned"] as const).map((status) =>
        groups[status].length > 0 ? (
          <List.Section
            key={status}
            title={status === "cleaned" ? "Cleaned" : status === "failed" ? "Failed" : "Cancelled"}
            subtitle={String(groups[status].length)}
          >
            {groups[status].map((item) => (
              <List.Item
                key={item.candidateId}
                title={item.title}
                subtitle={item.message}
                icon={{
                  source: status === "cleaned" ? Icon.CheckCircle : status === "failed" ? Icon.XMarkCircle : Icon.Stop,
                  tintColor: status === "cleaned" ? Color.Green : status === "failed" ? Color.Red : Color.Orange,
                }}
                accessories={[{ text: `${formatBytes(item.bytesReclaimed)} reclaimed` }, { tag: item.providerId }]}
                actions={
                  <ActionPanel>
                    <Action.CopyToClipboard
                      title="Copy Result"
                      content={`${item.title}: ${item.message ?? item.status}`}
                    />
                    <Action.CopyToClipboard title="Copy Full Report" content={report} />
                    <Action.CopyToClipboard title="Export Report as JSON" content={JSON.stringify(run, null, 2)} />
                    {status === "failed" && onRetry ? (
                      <Action title="Retry Failed Items" icon={Icon.ArrowClockwise} onAction={onRetry} />
                    ) : null}
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        ) : null,
      )}
    </List>
  );
}

export function CleanupHistory() {
  const [history, setHistory] = useState<CleanupRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    readCleanupHistory().then((runs) => {
      setHistory(runs);
      setIsLoading(false);
    });
  }, []);

  return (
    <List isLoading={isLoading} navigationTitle="Cleanup History">
      <List.EmptyView
        icon={Icon.Clock}
        title="No Cleanup History"
        description="Completed cleanup runs will appear here."
      />
      {history.map((run) => {
        const failures = run.items.filter((item) => item.status === "failed").length;
        return (
          <List.Item
            key={run.id}
            title={new Date(run.completedAt).toLocaleString()}
            subtitle={`${run.items.length} item${run.items.length === 1 ? "" : "s"}`}
            icon={{
              source: failures > 0 ? Icon.Warning : Icon.CheckCircle,
              tintColor: failures > 0 ? Color.Orange : Color.Green,
            }}
            accessories={failures > 0 ? [{ tag: `${failures} failed` }] : [{ tag: "Completed" }]}
            actions={
              <ActionPanel>
                <Action.Push title="View Cleanup Report" icon={Icon.List} target={<CleanupReport run={run} />} />
                <Action.CopyToClipboard title="Copy Full Report" content={reportText(run)} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
