import { highlightFile } from "./highlight";

type PackFile = { path: string; content: string | null };

function createDoneIcon(): SVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.5");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("copy-done-icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m5 12 4 4L19 6");
  icon.append(path);

  return icon;
}

/**
 * Copies through the shared data-copy-text affordance: the button flips to a
 * done check for a moment, exactly like the landing site's hero and
 * playground. Delegated so buttons added later use the current control.
 */
function bindCopyTextButtons(): void {
  const originalChildrenByButton = new WeakMap<HTMLButtonElement, Node[]>();
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>(
      "button[data-copy-text]",
    );
    if (!button) return;

    const originalChildren = originalChildrenByButton.get(button) ?? [
      ...button.childNodes,
    ];
    originalChildrenByButton.set(button, originalChildren);
    const text = button.dataset.copyText ?? "";
    navigator.clipboard.writeText(text).then(() => {
      button.replaceChildren(createDoneIcon());
      setTimeout(() => {
        button.replaceChildren(...originalChildren);
      }, 1600);
    });
  });
}

/**
 * Overview/Files content tabs. The selected tab is mirrored to the URL hash
 (#files) so the Files inspector deep links; unknown hashes fall back to the
 * overview.
 */
export function contentTabs(): void {
  const tabs = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-content-tab]"),
  ];
  if (tabs.length === 0) return;

  const panels = new Map(
    [...document.querySelectorAll<HTMLElement>("[data-content-panel]")].map(
      (panel) => [panel.dataset.contentPanel ?? "", panel],
    ),
  );

  const select = (name: string): void => {
    for (const tab of tabs) {
      tab.setAttribute(
        "aria-selected",
        String(tab.dataset.contentTab === name),
      );
    }
    for (const [panelName, panel] of panels) {
      panel.hidden = panelName !== name;
    }
  };

  const tabFromHash = (): string =>
    location.hash === "#files" ? "files" : "overview";

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      select(tab.dataset.contentTab ?? "overview");
      history.replaceState(
        null,
        "",
        `#${tab.dataset.contentTab ?? "overview"}`,
      );
    });
  }

  window.addEventListener("hashchange", () => {
    select(tabFromHash());
  });

  select(tabFromHash());
}

export function installPanel(): void {
  bindCopyTextButtons();

  const commandText = document.querySelector<HTMLElement>("#command-text");
  const payloadScript = document.querySelector<HTMLScriptElement>(
    'script[type="application/json"]#pack-files',
  );

  // Installation commands: switching the tab also updates the copy text.
  if (commandText) {
    const pack = commandText.dataset.package ?? "";
    const commands = new Map<string, string>([
      ["init", `npx atlante@latest init --pack ${pack}`],
      ["install", `npx atlante pack install ${pack}`],
    ]);
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-command-kind]"),
    ];
    const copyButton = document.querySelector<HTMLButtonElement>(
      "[data-install-copy]",
    );
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        const kind = tab.dataset.commandKind ?? "init";
        for (const candidate of tabs) {
          candidate.setAttribute("aria-selected", String(candidate === tab));
        }
        const command = commands.get(kind);
        if (command) {
          commandText.textContent = command;
          if (copyButton) copyButton.dataset.copyText = command;
        }
      });
    }
  }

  // Pack contents: a playground-style file selector over the embedded files.
  if (payloadScript?.textContent) {
    let files: PackFile[];
    try {
      files = JSON.parse(payloadScript.textContent) as PackFile[];
    } catch {
      return;
    }
    const byPath = new Map(
      files.map((file) => [file.path, file.content] as const),
    );
    const fileSelect =
      document.querySelector<HTMLSelectElement>("[data-file-select]");
    const fileName = document.querySelector<HTMLElement>("[data-file-name]");
    const fileView = document.querySelector<HTMLElement>(
      "pre[data-file-view] code",
    );

    const emptyPreview = "Preview not available: this file is too large.";

    const render = (): void => {
      const path = fileSelect?.value ?? "";
      const content = byPath.get(path);
      if (fileName) fileName.textContent = path;
      if (fileView) {
        fileView.innerHTML =
          content === undefined
            ? "File not available."
            : content === null
              ? emptyPreview
              : highlightFile(path, content);
      }
    };

    fileSelect?.addEventListener("change", () => {
      render();
    });
    render();
  }
}
