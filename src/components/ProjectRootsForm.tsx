import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { useState } from "react";

import { writeProjectRoots } from "../storage";

interface ProjectRootsFormProps {
  initialRoots?: string[];
  onSave: (roots: string[]) => void;
}

export function ProjectRootsForm({ initialRoots = [], onSave }: ProjectRootsFormProps) {
  const [roots, setRoots] = useState(initialRoots);
  const { pop } = useNavigation();

  async function submit() {
    await writeProjectRoots(roots);
    onSave(roots);
    await showToast({ style: Toast.Style.Success, title: "Project roots saved" });
    pop();
  }

  return (
    <Form
      navigationTitle="Project Scan Roots"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={roots.length === 0 ? "Continue Without Project Scanning" : "Save Project Roots"}
            icon={roots.length === 0 ? Icon.ArrowRight : Icon.CheckCircle}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Developer Cleaner only searches these directories for generated project artifacts. Leave this empty to scan tools and caches only. Symlinks are never followed." />
      <Form.FilePicker
        id="roots"
        title="Project Directories"
        value={roots}
        onChange={setRoots}
        allowMultipleSelection
        canChooseDirectories
        canChooseFiles={false}
      />
    </Form>
  );
}
