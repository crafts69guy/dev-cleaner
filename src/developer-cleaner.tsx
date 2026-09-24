import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  Keyboard,
  List,
  Toast,
  confirmAlert,
  getPreferenceValues,
  showToast,
  useNavigation,
} from "@raycast/api";
import os from "node:os";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cleanCandidates } from "./cleanup";
import { CleanupHistory, CleanupReport } from "./components/CleanupHistory";
import { ProjectRootsForm } from "./components/ProjectRootsForm";
import { isAbortError } from "./lib/async";
import { formatAge, formatBytes } from "./lib/format";
import { scanAll } from "./providers";
import { readProjectRoots, recordCleanupRun } from "./storage";
import type { CleanupCandidate, ScanIssue } from "./types";

function iconFor(candidate: CleanupCandidate) {
  const source = candidate.cleanupPolicy === "command" ? Icon.Terminal : Icon.Folder;
  const tintColor = candidate.risk === "high" ? Color.Red : candidate.risk === "review" ? Color.Orange : Color.Green;
  return { source, tintColor };
}

function candidateMarkdown(candidate: CleanupCandidate): string {
  const lines = [
    `# ${candidate.title}`,
    "",
    candidate.description,
    "",
    `- **Provider:** ${candidate.providerId}`,
    `- **Policy:** ${candidate.cleanupPolicy === "trash" ? "Move to Trash" : "Native cleanup command"}`,
    `- **Risk:** ${candidate.risk}`,
    `- **Current size:** ${formatBytes(candidate.bytes)}`,
  ];
  if (candidate.modifiedAt) lines.push(`- **Last modified:** ${candidate.modifiedAt.toLocaleString()}`);
  lines.push("", "```text", candidate.subtitle, "```");
  return lines.join("\n");
}

function CandidateActions({
  candidate,
  isSelected,
  toggle,
  cleanSelection,
  refresh,
  isLoading,
  cancelScan,
  selectSafe,
  clearSelection,
  roots,
  configure,
}: {
  candidate: CleanupCandidate;
  isSelected: boolean;
  toggle: () => void;
  cleanSelection: () => Promise<void>;
  refresh: () => void;
  isLoading: boolean;
  cancelScan: () => void;
  selectSafe: () => void;
  clearSelection: () => void;
  roots: string[];
  configure: (roots: string[]) => void;
}) {
  return (
    <ActionPanel>
      <Action
        title={isSelected ? "Unselect Item" : "Select Item"}
        icon={isSelected ? Icon.Circle : Icon.CheckCircle}
        onAction={toggle}
      />
      {isLoading ? (
        <Action title="Cancel Scan" icon={Icon.Stop} onAction={cancelScan} />
      ) : (
        <Action
          title="Clean Selected Items"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
          onAction={cleanSelection}
        />
      )}
      <Action title="Select All Safe Items" icon={Icon.CheckCircle} onAction={selectSafe} />
      <Action title="Clear Selection" icon={Icon.Circle} onAction={clearSelection} />
      {candidate.path ? <Action.ShowInFinder path={candidate.path} /> : null}
      <Action
        title="Refresh Scan"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={refresh}
      />
      <Action.Push
        title="Configure Project Roots"
        icon={Icon.Gear}
        target={<ProjectRootsForm initialRoots={roots} onSave={configure} />}
      />
      <Action.Push title="View Cleanup History" icon={Icon.Clock} target={<CleanupHistory />} />
    </ActionPanel>
  );
}

function Dashboard({ roots, setRoots }: { roots: string[]; setRoots: (roots: string[]) => void }) {
  const preferences = getPreferenceValues<Preferences>();
  const { push } = useNavigation();
  const homeDirectory = os.homedir();
  const [candidates, setCandidates] = useState<CleanupCandidate[]>([]);
  const [issues, setIssues] = useState<ScanIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [scanVersion, setScanVersion] = useState(0);
  const scanController = useRef<AbortController | undefined>(undefined);

  const context = useMemo(
    () => ({ homeDirectory, projectRoots: roots, extraPath: preferences.extraPath }),
    [homeDirectory, preferences.extraPath, roots],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    scanController.current?.abort();
    scanController.current = controller;
    setIsLoading(true);
    setCandidates([]);
    setIssues([]);
    scanAll({ ...context, signal: controller.signal }, (partial) => {
      if (!active) return;
      setCandidates(partial.candidates);
      setIssues(partial.issues);
    })
      .then((result) => {
        if (!active) return;
        setCandidates(result.candidates);
        setIssues(result.issues);
        setSelected(new Set(result.candidates.filter((candidate) => candidate.selectedByDefault).map(({ id }) => id)));
      })
      .catch(async (error) => {
        if (active && !isAbortError(error))
          await showToast({ style: Toast.Style.Failure, title: "Scan failed", message: (error as Error).message });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [context, scanVersion]);

  const refresh = useCallback(() => setScanVersion((version) => version + 1), []);
  const cancelScan = useCallback(() => {
    scanController.current?.abort();
    setIsLoading(false);
  }, []);
  const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));

  async function cleanSelection() {
    if (selectedCandidates.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "No cleanup items selected" });
      return;
    }
    const permanent = selectedCandidates.filter((candidate) => candidate.cleanupPolicy === "command").length;
    const trashBytes = selectedCandidates
      .filter((candidate) => candidate.cleanupPolicy === "trash")
      .reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0);
    const currentFootprint = selectedCandidates.reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0);
    const confirmed = await confirmAlert({
      title: `Clean ${selectedCandidates.length} selected item${selectedCandidates.length === 1 ? "" : "s"}?`,
      message: `The known selected footprint is ${formatBytes(currentFootprint)}. ${formatBytes(trashBytes)} will move to Trash and only frees disk space after Trash is emptied. ${permanent} native cleanup command${permanent === 1 ? " is" : "s are"} permanent and will determine its own reclaimable amount.`,
      primaryAction: { title: "Clean Selected", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const startedAt = new Date();
    const toast = await showToast({ style: Toast.Style.Animated, title: "Cleaning selected items…" });
    const results = await cleanCandidates(selectedCandidates, context, (completed, count) => {
      toast.message = `${completed} of ${count}`;
    });
    const failures = results.filter((result) => result.status === "failed");
    toast.style = failures.length === 0 ? Toast.Style.Success : Toast.Style.Failure;
    toast.title =
      failures.length === 0
        ? "Cleanup completed"
        : `Cleanup completed with ${failures.length} failure${failures.length === 1 ? "" : "s"}`;
    toast.message =
      failures
        .map((failure) => failure.message)
        .join("; ")
        .slice(0, 500) || undefined;
    const run = await recordCleanupRun(selectedCandidates, results, startedAt, new Date());
    push(<CleanupReport run={run} />);
    refresh();
  }

  const sections = useMemo(() => {
    const grouped = new Map<string, CleanupCandidate[]>();
    for (const candidate of candidates) {
      grouped.set(candidate.section, [...(grouped.get(candidate.section) ?? []), candidate]);
    }
    return grouped;
  }, [candidates]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectSafe = useCallback(
    () =>
      setSelected(
        new Set(candidates.filter((candidate) => candidate.risk === "safe").map((candidate) => candidate.id)),
      ),
    [candidates],
  );
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return (
    <List isLoading={isLoading} isShowingDetail searchBarPlaceholder="Search cleanup candidates">
      <List.EmptyView
        icon={Icon.HardDrive}
        title={isLoading ? "Scanning developer data…" : "Nothing to clean"}
        description={
          issues.length > 0
            ? issues.map((issue) => issue.message).join("\n")
            : "Refresh the scan or configure another project root."
        }
        actions={
          <ActionPanel>
            <Action title="Refresh Scan" icon={Icon.ArrowClockwise} onAction={refresh} />
            {isLoading ? <Action title="Cancel Scan" icon={Icon.Stop} onAction={cancelScan} /> : null}
            <Action.Push
              title="Configure Project Roots"
              icon={Icon.Gear}
              target={<ProjectRootsForm initialRoots={roots} onSave={setRoots} />}
            />
            <Action.Push title="View Cleanup History" icon={Icon.Clock} target={<CleanupHistory />} />
          </ActionPanel>
        }
      />
      {[...sections].map(([section, items]) => (
        <List.Section key={section} title={section} subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}>
          {items.map((candidate) => {
            const isSelected = selected.has(candidate.id);
            return (
              <List.Item
                key={candidate.id}
                title={candidate.title}
                subtitle={formatAge(candidate.modifiedAt)}
                icon={iconFor(candidate)}
                accessories={[
                  { text: formatBytes(candidate.bytes) },
                  {
                    icon: isSelected ? Icon.CheckCircle : Icon.Circle,
                    tooltip: isSelected ? "Selected" : "Not selected",
                  },
                ]}
                detail={<List.Item.Detail markdown={candidateMarkdown(candidate)} />}
                actions={
                  <CandidateActions
                    candidate={candidate}
                    isSelected={isSelected}
                    toggle={() => toggle(candidate.id)}
                    cleanSelection={cleanSelection}
                    refresh={refresh}
                    isLoading={isLoading}
                    cancelScan={cancelScan}
                    selectSafe={selectSafe}
                    clearSelection={clearSelection}
                    roots={roots}
                    configure={setRoots}
                  />
                }
              />
            );
          })}
        </List.Section>
      ))}
      {issues.length > 0 ? (
        <List.Section title="Scan Warnings" subtitle={String(issues.length)}>
          {issues.map((issue, index) => (
            <List.Item
              key={`${issue.providerId}:${index}`}
              title={issue.providerId}
              subtitle={issue.message}
              icon={{ source: Icon.Warning, tintColor: Color.Orange }}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}

export default function Command() {
  const [roots, setRoots] = useState<string[] | undefined>();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    readProjectRoots().then((storedRoots) => {
      setRoots(storedRoots);
      setIsReady(true);
    });
  }, []);

  if (!isReady) return <List isLoading />;
  if (!roots) return <ProjectRootsForm onSave={setRoots} />;
  return <Dashboard roots={roots} setRoots={setRoots} />;
}
