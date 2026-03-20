import * as vscode from "vscode";
import * as path from "path";

type TrackedFileRecord = {
  uri: string;
  lastModified: number;
};

class WorkingContextItem extends vscode.TreeItem {
  public readonly uri: vscode.Uri;

  constructor(
    uri: vscode.Uri,
    public readonly lastModified: number,
  ) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    this.uri = uri;
    this.resourceUri = uri;
    this.description = vscode.workspace.asRelativePath(uri, false);
    this.contextValue = "workingContextFile";
    this.tooltip = `${vscode.workspace.asRelativePath(uri, false)}\nLast modified: ${new Date(lastModified).toLocaleString()}`;
    this.command = {
      command: "working-context.openFile",
      title: "Open File",
      arguments: [this],
    };
  }
}

class WorkingContextProvider implements vscode.TreeDataProvider<WorkingContextItem> {
  private static readonly stateKey = "workingContext.files";
  private readonly records = new Map<string, TrackedFileRecord>();
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorkingContextItem | undefined
  >();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.restore();
  }

  public getTreeItem(element: WorkingContextItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): WorkingContextItem[] {
    return this.getSortedRecords().map(
      (record) =>
        new WorkingContextItem(
          vscode.Uri.parse(record.uri),
          record.lastModified,
        ),
    );
  }

  public upsert(uri: vscode.Uri): void {
    const key = uri.toString();
    this.records.set(key, { uri: key, lastModified: Date.now() });
    void this.persist();
    this.refresh();
  }

  public remove(uri: vscode.Uri): void {
    const key = uri.toString();
    if (!this.records.delete(key)) {
      return;
    }

    void this.persist();
    this.refresh();
  }

  public clearAll(): void {
    if (this.records.size === 0) {
      return;
    }

    this.records.clear();
    void this.persist();
    this.refresh();
  }

  private refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  private getSortedRecords(): TrackedFileRecord[] {
    return [...this.records.values()].sort(
      (a, b) => b.lastModified - a.lastModified,
    );
  }

  private restore(): void {
    const saved = this.extensionContext.workspaceState.get<TrackedFileRecord[]>(
      WorkingContextProvider.stateKey,
      [],
    );
    for (const record of saved) {
      this.records.set(record.uri, record);
    }
  }

  private async persist(): Promise<void> {
    await this.extensionContext.workspaceState.update(
      WorkingContextProvider.stateKey,
      this.getSortedRecords(),
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new WorkingContextProvider(context);
  const treeView = vscode.window.createTreeView("workingContextView", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const debouncedUpdates = new Map<string, NodeJS.Timeout>();
  const scheduleTrack = (uri: vscode.Uri) => {
    const key = uri.toString();
    const existing = debouncedUpdates.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      provider.upsert(uri);
      debouncedUpdates.delete(key);
    }, 350);

    debouncedUpdates.set(key, timer);
  };

  const openFileCommand = vscode.commands.registerCommand(
    "working-context.openFile",
    async (item?: WorkingContextItem) => {
      if (!item) {
        return;
      }

      const document = await vscode.workspace.openTextDocument(item.uri);
      await vscode.window.showTextDocument(document, { preview: false });
    },
  );

  const removeFileCommand = vscode.commands.registerCommand(
    "working-context.removeFile",
    (item: WorkingContextItem) => {
      if (!item) {
        return;
      }

      provider.remove(item.uri);
    },
  );

  const clearAllCommand = vscode.commands.registerCommand(
    "working-context.clearAll",
    () => {
      provider.clearAll();
    },
  );

  const onChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (event.contentChanges.length === 0) {
        return;
      }

      if (event.document.isUntitled || event.document.uri.scheme !== "file") {
        return;
      }

      scheduleTrack(event.document.uri);
    },
  );

  const cleanupDebounceTimers = {
    dispose: () => {
      for (const timer of debouncedUpdates.values()) {
        clearTimeout(timer);
      }
      debouncedUpdates.clear();
    },
  };

  context.subscriptions.push(
    treeView,
    openFileCommand,
    removeFileCommand,
    clearAllCommand,
    onChangeTextDocument,
    cleanupDebounceTimers,
  );
}

export function deactivate() {}
