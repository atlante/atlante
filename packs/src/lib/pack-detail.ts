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
      showToast("Select the command to copy");
    }
  });

  // Package file browser.
  if (payloadScript?.textContent) {
    let files: Array<{ path: string; content: string | null }>;
    try {
      files = JSON.parse(payloadScript.textContent) as typeof files;
    } catch {
      return;
    }
    const byPath = new Map(files.map((file) => [file.path, file]));
    const previewHeader = document.querySelector<HTMLElement>(
      ".file-preview-header",
    );
    const previewCode = document.querySelector<HTMLElement>(
      ".file-preview pre code",
    );
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-file]"),
    ];
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const path = button.dataset.file ?? "";
        for (const candidate of buttons) {
          candidate.setAttribute("aria-pressed", String(candidate === button));
        }
        const file = byPath.get(path);
        if (previewHeader) previewHeader.textContent = path;
        if (previewCode) {
          previewCode.textContent =
            file === undefined
              ? "File not available."
              : (file.content ??
                "Preview not available: this file is too large.");
        }
      });
    }
  }
}
