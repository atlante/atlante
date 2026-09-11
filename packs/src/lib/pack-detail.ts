import { highlightFile } from "./highlight";

type PackFile = { path: string; content: string | null };

export function installPanel(): void {
  const commandText = document.querySelector<HTMLElement>("#command-text");
  const toast = document.querySelector<HTMLElement>("#toast");
  const payloadScript = document.querySelector<HTMLScriptElement>(
    'script[type="application/json"]#pack-files',
  );

  let toastTimer: number | undefined;
  const showToast = (message: string): void => {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
      toast.hidden = true;
    }, 1800);
  };

  // Installation commands.
  if (commandText) {
    const pack = commandText.dataset.package ?? "";
    const commands = new Map<string, string>([
      ["init", `npx atlante@latest init --pack ${pack}`],
      ["install", `npm install --save-dev ${pack}`],
    ]);
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-command-kind]"),
    ];
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        const kind = tab.dataset.commandKind ?? "init";
        for (const candidate of tabs) {
          candidate.setAttribute("aria-selected", String(candidate === tab));
        }
        const command = commands.get(kind);
        if (command) commandText.textContent = command;
      });
    }
  }

  const copyButton = document.querySelector<HTMLButtonElement>(
    "[data-copy-command]",
  );
  copyButton?.addEventListener("click", async () => {
    const command = commandText?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(command);
      showToast("Command copied");
    } catch {
      showToast("Clipboard unavailable; select the command to copy");
    }
  });

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
