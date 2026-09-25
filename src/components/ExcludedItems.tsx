import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useState } from "react";

import type { ExcludedItem } from "../types";

export function ExcludedItems({
  initialItems,
  onAllow,
}: {
  initialItems: ExcludedItem[];
  onAllow: (id: string) => Promise<boolean>;
}) {
  const [items, setItems] = useState(initialItems);

  async function allow(id: string) {
    if (await onAllow(id)) setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <List navigationTitle="Kept Items" searchBarPlaceholder="Search kept items">
      <List.EmptyView
        icon={Icon.Shield}
        title="No Kept Items"
        description="Use Keep Item on a cleanup candidate to exclude it from future cleanup."
      />
      {items.map((item) => (
        <List.Item
          key={item.id}
          title={item.title}
          subtitle={item.subtitle}
          icon={{ source: Icon.Shield, tintColor: Color.Green }}
          accessories={[{ tag: item.providerId }]}
          keywords={[item.id, item.providerId]}
          actions={
            <ActionPanel>
              <Action title="Allow Cleanup Again" icon={Icon.Undo} onAction={() => allow(item.id)} />
              {item.path ? <Action.ShowInFinder path={item.path} /> : null}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
