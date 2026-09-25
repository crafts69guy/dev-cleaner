import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Detail,
  Grid,
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
import type { CleanupCandidate, ProtectedItem, RiskLevel, ScanIssue } from "./types";

function iconFor(candidate: CleanupCandidate) {
  const source = candidate.cleanupPolicy === "command" ? Icon.Terminal : Icon.Folder;
  const tintColor = candidate.risk === "high" ? Color.Red : candidate.risk === "review" ? Color.Orange : Color.Green;
  return { source, tintColor };
}

function candidateMarkdown(candidate: CleanupCandidate): string {
  const lines = [`# ${candidate.title}`, "", candidate.description];
  lines.push("", "```text", candidate.subtitle, "```");
  return lines.join("\n");
}

function riskLabel(risk: RiskLevel): string {
  return risk === "safe" ? "Safe" : risk === "review" ? "Review" : "High Risk";
}

function riskColor(risk: RiskLevel): Color {
  return risk === "safe" ? Color.Green : risk === "review" ? Color.Orange : Color.Red;
}

function CandidateDetail({ candidate }: { candidate: CleanupCandidate }) {
  return (
    <Detail
      navigationTitle={candidate.title}
      markdown={candidateMarkdown(candidate)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Current Footprint" text={formatBytes(candidate.bytes)} />
          <Detail.Metadata.TagList title="Risk">
            <Detail.Metadata.TagList.Item text={riskLabel(candidate.risk)} color={riskColor(candidate.risk)} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label
            title="Cleanup Method"
            text={candidate.cleanupPolicy === "trash" ? "Move to Trash" : "Permanent native command"}
          />
          <Detail.Metadata.Label title="Source" text={candidate.providerId} />
          {candidate.modifiedAt ? (
            <Detail.Metadata.Label title="Last Modified" text={candidate.modifiedAt.toLocaleString()} />
          ) : null}
        </Detail.Metadata>
      }
      actions={
        candidate.path ? (
          <ActionPanel>
            <Action.ShowInFinder path={candidate.path} />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

function CandidateActions({
  candidate,
  isSelected,
  selectedCount,
  toggle,
  cleanSelection,
  refresh,
  isLoading,
  cancelScan,
  selectSafe,
  selectLarge,
  clearSelection,
  roots,
  configure,
  isCleaning,
  cancelCleanup,
  cycleSort,
  sortMode,
  viewMode,
  setViewMode,
}: {
  candidate: CleanupCandidate;
  isSelected: boolean;
  selectedCount: number;
  toggle: () => void;
  cleanSelection: () => Promise<void>;
  refresh: () => void;
  isLoading: boolean;
  cancelScan: () => void;
  selectSafe: () => void;
  selectLarge: () => void;
  clearSelection: () => void;
  roots: string[];
  configure: (roots: string[]) => void;
  isCleaning: boolean;
  cancelCleanup: () => void;
  cycleSort: () => void;
  sortMode: "size" | "age" | "name";
  viewMode: "list" | "cards";
  setViewMode: (mode: "list" | "cards") => void;
}) {
  return (
    <ActionPanel>
      {isCleaning ? (
        <Action title="Cancel Cleanup" icon={Icon.Stop} onAction={cancelCleanup} />
      ) : (
        <Action
          title={isSelected ? "Unselect Item" : "Select Item"}
          icon={isSelected ? Icon.Circle : Icon.CheckCircle}
          onAction={toggle}
        />
      )}
      <Action.Push title="View Item Details" icon={Icon.Eye} target={<CandidateDetail candidate={candidate} />} />
      {isLoading ? (
        <Action title="Cancel Scan" icon={Icon.Stop} onAction={cancelScan} />
      ) : !isCleaning && selectedCount > 0 ? (
        <Action
          title="Clean Selected Items"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
          onAction={cleanSelection}
        />
      ) : null}
      {!isCleaning ? (
        <>
          <Action title="Preset: Safe Items" icon={Icon.CheckCircle} onAction={selectSafe} />
          <Action title="Preset: Large Review Items" icon={Icon.HardDrive} onAction={selectLarge} />
          <Action title="Clear Selection" icon={Icon.Circle} onAction={clearSelection} />
          <Action
            title={`Sort by ${sortMode === "size" ? "Age" : sortMode === "age" ? "Name" : "Size"}`}
            icon={Icon.List}
            onAction={cycleSort}
          />
          <Action
            title={viewMode === "list" ? "Show Cards" : "Show List"}
            icon={viewMode === "list" ? Icon.AppWindowGrid3x3 : Icon.List}
            shortcut={{ modifiers: ["cmd"], key: "l" }}
            onAction={() => setViewMode(viewMode === "list" ? "cards" : "list")}
          />
        </>
      ) : null}
      {candidate.path ? <Action.ShowInFinder path={candidate.path} /> : null}
      {!isCleaning ? (
        <Action
          title="Refresh Scan"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={refresh}
        />
      ) : null}
      {!isCleaning ? (
        <Action.Push
          title="Configure Project Roots"
          icon={Icon.Gear}
          target={<ProjectRootsForm initialRoots={roots} onSave={configure} />}
        />
      ) : null}
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
  const [protectedItems, setProtectedItems] = useState<ProtectedItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"all" | RiskLevel>("all");
  const [sortMode, setSortMode] = useState<"size" | "age" | "name">("size");
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");
  const [searchText, setSearchText] = useState("");
  const [scanVersion, setScanVersion] = useState(0);
  const scanController = useRef<AbortController | undefined>(undefined);
  const cleanupController = useRef<AbortController | undefined>(undefined);

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
    setProtectedItems([]);
    setSelected(new Set());
    scanAll({ ...context, signal: controller.signal }, (partial) => {
      if (!active) return;
      setCandidates(partial.candidates);
      setIssues(partial.issues);
      setProtectedItems(partial.protectedItems ?? []);
    })
      .then((result) => {
        if (!active) return;
        setCandidates(result.candidates);
        setIssues(result.issues);
        setProtectedItems(result.protectedItems ?? []);
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
  const cancelCleanup = useCallback(() => cleanupController.current?.abort(), []);
  const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));

  async function runCleanup(targets: CleanupCandidate[]) {
    if (cleanupController.current) return;
    if (targets.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "No cleanup items selected" });
      return;
    }
    const permanent = targets.filter((candidate) => candidate.cleanupPolicy === "command").length;
    const trashBytes = targets
      .filter((candidate) => candidate.cleanupPolicy === "trash")
      .reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0);
    const currentFootprint = targets.reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0);
    const confirmed = await confirmAlert({
      title: `Clean ${targets.length} selected item${targets.length === 1 ? "" : "s"}?`,
      message: `The known selected footprint is ${formatBytes(currentFootprint)}. ${formatBytes(trashBytes)} will move to Trash and only frees disk space after Trash is emptied. ${permanent} native cleanup command${permanent === 1 ? " is" : "s are"} permanent and will determine its own reclaimable amount.`,
      primaryAction: { title: "Clean Selected", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const controller = new AbortController();
    cleanupController.current = controller;
    setIsCleaning(true);
    const startedAt = new Date();
    const toast = await showToast({ style: Toast.Style.Animated, title: "Cleaning selected items…" });
    try {
      const results = await cleanCandidates(targets, { ...context, signal: controller.signal }, (completed, count) => {
        toast.message = `${completed} of ${count}`;
      });
      const failures = results.filter((result) => result.status === "failed");
      const cancelled = results.filter((result) => result.status === "cancelled");
      toast.style = failures.length === 0 && cancelled.length === 0 ? Toast.Style.Success : Toast.Style.Failure;
      toast.title =
        cancelled.length > 0
          ? "Cleanup cancelled"
          : failures.length === 0
            ? "Cleanup completed"
            : "Cleanup completed with failures";
      toast.message =
        failures.length > 0
          ? `${failures.length} failed`
          : cancelled.length > 0
            ? `${cancelled.length} cancelled`
            : undefined;
      const run = await recordCleanupRun(targets, results, startedAt, new Date());
      const failedIds = new Set(failures.map((failure) => failure.candidateId));
      const retryTargets = targets.filter((candidate) => failedIds.has(candidate.id));
      push(<CleanupReport run={run} onRetry={retryTargets.length > 0 ? () => runCleanup(retryTargets) : undefined} />);
      refresh();
    } finally {
      cleanupController.current = undefined;
      setIsCleaning(false);
    }
  }

  async function cleanSelection() {
    await runCleanup(selectedCandidates);
  }

  const sections = useMemo(() => {
    const grouped = new Map<string, CleanupCandidate[]>();
    const visibleCandidates = candidates
      .filter((candidate) => riskFilter === "all" || candidate.risk === riskFilter)
      .sort((left, right) => {
        if (sortMode === "name") return left.title.localeCompare(right.title);
        if (sortMode === "age")
          return (left.modifiedAt?.getTime() ?? Infinity) - (right.modifiedAt?.getTime() ?? Infinity);
        return (right.bytes ?? -1) - (left.bytes ?? -1);
      });
    for (const candidate of visibleCandidates) {
      grouped.set(candidate.section, [...(grouped.get(candidate.section) ?? []), candidate]);
    }
    return grouped;
  }, [candidates, riskFilter, sortMode]);

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
  const selectLarge = useCallback(
    () =>
      setSelected(
        new Set(
          candidates
            .filter((candidate) => candidate.risk !== "high" && (candidate.bytes ?? 0) >= 1024 ** 3)
            .map((candidate) => candidate.id),
        ),
      ),
    [candidates],
  );
  const cycleSort = useCallback(
    () => setSortMode((current) => (current === "size" ? "age" : current === "age" ? "name" : "size")),
    [],
  );

  const selectedBytes = selectedCandidates.reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0);
  const knownFootprint = selectedCandidates.some((candidate) => candidate.bytes !== undefined)
    ? formatBytes(selectedBytes)
    : "Size unavailable";
  const navigationTitle = selected.size ? `${selected.size} selected · ${knownFootprint}` : "Developer Cleaner";
  const emptyTitle = isLoading
    ? "Scanning developer data…"
    : candidates.length > 0
      ? "No matching items"
      : "Nothing to clean";
  const emptyDescription =
    candidates.length > 0
      ? "Try another search or risk filter."
      : issues.length > 0
        ? issues.map((issue) => issue.message).join("\n")
        : "Refresh the scan or configure another project root.";
  const viewAction = (
    <Action
      title={viewMode === "list" ? "Show Cards" : "Show List"}
      icon={viewMode === "list" ? Icon.AppWindowGrid3x3 : Icon.List}
      shortcut={{ modifiers: ["cmd"], key: "l" }}
      onAction={() => setViewMode(viewMode === "list" ? "cards" : "list")}
    />
  );
  const emptyActions = (
    <ActionPanel>
      {isCleaning ? (
        <Action title="Cancel Cleanup" icon={Icon.Stop} onAction={cancelCleanup} />
      ) : (
        <Action title="Refresh Scan" icon={Icon.ArrowClockwise} onAction={refresh} />
      )}
      {viewAction}
      {isLoading && !isCleaning ? <Action title="Cancel Scan" icon={Icon.Stop} onAction={cancelScan} /> : null}
      {!isCleaning ? (
        <Action.Push
          title="Configure Project Roots"
          icon={Icon.Gear}
          target={<ProjectRootsForm initialRoots={roots} onSave={setRoots} />}
        />
      ) : null}
      <Action.Push title="View Cleanup History" icon={Icon.Clock} target={<CleanupHistory />} />
    </ActionPanel>
  );
  const candidateActions = (candidate: CleanupCandidate) => (
    <CandidateActions
      candidate={candidate}
      isSelected={selected.has(candidate.id)}
      selectedCount={selected.size}
      toggle={() => toggle(candidate.id)}
      cleanSelection={cleanSelection}
      refresh={refresh}
      isLoading={isLoading}
      cancelScan={cancelScan}
      selectSafe={selectSafe}
      selectLarge={selectLarge}
      clearSelection={clearSelection}
      roots={roots}
      configure={setRoots}
      isCleaning={isCleaning}
      cancelCleanup={cancelCleanup}
      cycleSort={cycleSort}
      sortMode={sortMode}
      viewMode={viewMode}
      setViewMode={setViewMode}
    />
  );

  if (viewMode === "cards") {
    return (
      <Grid
        isLoading={isLoading || isCleaning}
        navigationTitle={navigationTitle}
        columns={3}
        filtering={true}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchBarPlaceholder="Search cleanup candidates"
        searchBarAccessory={
          <Grid.Dropdown
            tooltip="Filter by risk"
            value={riskFilter}
            onChange={(value) => setRiskFilter(value as "all" | RiskLevel)}
          >
            <Grid.Dropdown.Item title="All Risk Levels" value="all" />
            <Grid.Dropdown.Item title="Safe" value="safe" />
            <Grid.Dropdown.Item title="Review" value="review" />
            <Grid.Dropdown.Item title="High Risk" value="high" />
          </Grid.Dropdown>
        }
      >
        <Grid.EmptyView
          icon={Icon.HardDrive}
          title={emptyTitle}
          description={emptyDescription}
          actions={emptyActions}
        />
        {[...sections].map(([section, items]) => (
          <Grid.Section key={section} title={section} subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}>
            {items.map((candidate) => (
              <Grid.Item
                key={candidate.id}
                id={candidate.id}
                title={candidate.title}
                subtitle={`${formatBytes(candidate.bytes)} · ${riskLabel(candidate.risk)}`}
                content={iconFor(candidate)}
                keywords={[candidate.providerId, candidate.subtitle, riskLabel(candidate.risk)]}
                accessory={
                  selected.has(candidate.id) ? { icon: Icon.CheckCircle, tooltip: "Selected for cleanup" } : undefined
                }
                actions={candidateActions(candidate)}
              />
            ))}
          </Grid.Section>
        ))}
        {issues.length > 0 ? (
          <Grid.Section title="Scan Warnings" subtitle={String(issues.length)}>
            {issues.map((issue, index) => (
              <Grid.Item
                key={`${issue.providerId}:${index}`}
                title={issue.providerId}
                subtitle={issue.message}
                content={{ source: Icon.Warning, tintColor: Color.Orange }}
                actions={<ActionPanel>{viewAction}</ActionPanel>}
              />
            ))}
          </Grid.Section>
        ) : null}
        {protectedItems.length > 0 ? (
          <Grid.Section title="Protected Runtimes" subtitle={String(protectedItems.length)}>
            {protectedItems.map((item) => (
              <Grid.Item
                key={item.id}
                title={item.title}
                subtitle={item.reason}
                content={{ source: Icon.Shield, tintColor: Color.Green }}
                actions={
                  <ActionPanel>
                    {item.path ? <Action.ShowInFinder path={item.path} /> : null}
                    {viewAction}
                  </ActionPanel>
                }
              />
            ))}
          </Grid.Section>
        ) : null}
      </Grid>
    );
  }

  return (
    <List
      isLoading={isLoading || isCleaning}
      navigationTitle={navigationTitle}
      filtering={true}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search cleanup candidates"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by risk"
          value={riskFilter}
          onChange={(value) => setRiskFilter(value as "all" | RiskLevel)}
        >
          <List.Dropdown.Item title="All Risk Levels" value="all" />
          <List.Dropdown.Item title="Safe" value="safe" />
          <List.Dropdown.Item title="Review" value="review" />
          <List.Dropdown.Item title="High Risk" value="high" />
        </List.Dropdown>
      }
    >
      <List.EmptyView icon={Icon.HardDrive} title={emptyTitle} description={emptyDescription} actions={emptyActions} />
      {[...sections].map(([section, items]) => (
        <List.Section key={section} title={section} subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}>
          {items.map((candidate) => {
            const isSelected = selected.has(candidate.id);
            return (
              <List.Item
                key={candidate.id}
                id={candidate.id}
                title={candidate.title}
                subtitle={formatAge(candidate.modifiedAt)}
                icon={iconFor(candidate)}
                keywords={[candidate.providerId, candidate.subtitle, riskLabel(candidate.risk)]}
                accessories={[
                  { text: formatBytes(candidate.bytes) },
                  { tag: { value: riskLabel(candidate.risk), color: riskColor(candidate.risk) } },
                  {
                    icon: isSelected ? Icon.CheckCircle : Icon.Circle,
                    tooltip: isSelected ? "Selected" : "Not selected",
                  },
                ]}
                actions={candidateActions(candidate)}
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
              actions={<ActionPanel>{viewAction}</ActionPanel>}
            />
          ))}
        </List.Section>
      ) : null}
      {protectedItems.length > 0 ? (
        <List.Section title="Protected Runtimes" subtitle={String(protectedItems.length)}>
          {protectedItems.map((item) => (
            <List.Item
              key={item.id}
              title={item.title}
              subtitle={item.reason}
              icon={{ source: Icon.Shield, tintColor: Color.Green }}
              accessories={[{ tag: item.providerId }]}
              actions={
                item.path ? (
                  <ActionPanel>
                    <Action.ShowInFinder path={item.path} />
                    {viewAction}
                  </ActionPanel>
                ) : (
                  <ActionPanel>{viewAction}</ActionPanel>
                )
              }
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
