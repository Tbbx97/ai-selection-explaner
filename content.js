(() => {
  const MAX_SELECTION_LENGTH = 20000;
  const host = document.createElement("div");
  host.id = "ai-selection-explainer-host";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "closed" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("content.css");
  shadow.append(stylesheet);

  const launcher = document.createElement("button");
  launcher.className = "aie-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Explain selected text with AI");
  launcher.title = "Explain selection";
  const launcherIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  launcherIcon.setAttribute("viewBox", "0 0 24 24");
  launcherIcon.setAttribute("aria-hidden", "true");
  const launcherPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  launcherPath.setAttribute("d", "M12 2.5 14.2 9l6.3 2.3-6.3 2.2L12 20l-2.2-6.5-6.3-2.2L9.8 9 12 2.5Zm7.2 13.1.9 2.6 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.6Z");
  launcherIcon.append(launcherPath);
  launcher.append(launcherIcon);
  launcher.hidden = true;
  shadow.append(launcher);

  const panel = document.createElement("section");
  panel.className = "aie-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI explanation");
  panel.hidden = true;

  const header = document.createElement("header");
  header.className = "aie-header";
  const heading = document.createElement("div");
  heading.className = "aie-heading";
  const badge = document.createElement("span");
  badge.className = "aie-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = "✦";
  const title = document.createElement("strong");
  title.textContent = "AI Explainer";
  heading.append(badge, title);
  const closeButton = document.createElement("button");
  closeButton.className = "aie-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close explanation");
  closeButton.textContent = "×";
  header.append(heading, closeButton);

  const selectionPreview = document.createElement("div");
  selectionPreview.className = "aie-selection";
  const response = document.createElement("div");
  response.className = "aie-response";
  response.setAttribute("aria-live", "polite");
  response.setAttribute("aria-busy", "false");
  const setupNotice = document.createElement("div");
  setupNotice.className = "aie-setup-notice";
  setupNotice.hidden = true;
  const setupText = document.createElement("p");
  setupText.textContent = "Bạn chưa cài đặt Chìa khóa AI.";
  const setupLink = document.createElement("button");
  setupLink.className = "aie-setup-link";
  setupLink.type = "button";
  setupLink.textContent = "Bấm vào đây để xem hướng dẫn lấy Key miễn phí trong 1 phút";
  setupNotice.append(setupText, setupLink);
  const status = document.createElement("p");
  status.className = "aie-status";
  status.textContent = "Select text on a webpage to get an explanation.";
  response.append(status);
  panel.append(header, selectionPreview, setupNotice, response);
  shadow.append(panel);

  let selectedText = "";
  let requestId = "";
  let pointer = { x: 0, y: 0 };

  document.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });

  document.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host)) {
      return;
    }
    pointer = { x: event.clientX, y: event.clientY };
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (text.length <= 5) {
        launcher.hidden = true;
        return;
      }
      selectedText = text.slice(0, MAX_SELECTION_LENGTH);
      positionElement(launcher, pointer.x + 10, pointer.y + 10, 48, 48);
      launcher.hidden = false;
    }, 0);
  }, true);

  launcher.addEventListener("click", async () => {
    launcher.hidden = true;
    selectionPreview.textContent = selectedText.slice(0, 240);
    if (selectedText.length > 240) {
      selectionPreview.textContent += "…";
    }
    if (selectedText.length >= MAX_SELECTION_LENGTH) {
      selectionPreview.textContent += " (selection limited to 20,000 characters)";
    }
    response.replaceChildren();
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "true");
    const loading = document.createElement("p");
    loading.className = "aie-status";
    loading.textContent = "Đang kết nối với nhà cung cấp AI…";
    response.append(loading);
    positionPanel(pointer.x + 10, pointer.y + 10);
    panel.hidden = false;

    if (requestId) {
      void chrome.runtime.sendMessage({ type: "CANCEL_EXPLANATION", requestId });
    }
    requestId = createRequestId();
    try {
      const providerStatus = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_STATUS" });
      if (!providerStatus?.ok) {
        showError(requestId, providerStatus?.error || "Could not check your saved AI key.");
        return;
      }
      if (!providerStatus.hasKey) {
        showSetupNotice();
        return;
      }

      setupNotice.hidden = true;
      const result = await chrome.runtime.sendMessage({
        type: "EXPLAIN_SELECTION",
        requestId,
        text: selectedText
      });
      if (!result?.ok) {
        showError(requestId, result?.error || "Could not start the explanation request.");
      }
    } catch {
      showError(requestId, "Could not contact the extension service worker. Reload the extension and try again.");
    }
  });

  closeButton.addEventListener("click", () => {
    cancelCurrentRequest();
    panel.hidden = true;
    launcher.hidden = true;
  });

  setupLink.addEventListener("click", async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
      if (!result?.ok) {
        showError(requestId, result?.error || "Could not open the setup guide.");
      }
    } catch {
      showError(requestId, "Could not open the setup guide. Open the extension Options from chrome://extensions.");
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.requestId !== requestId) {
      return;
    }
    if (message.type === "EXPLANATION_STATUS" && typeof message.status === "string") {
      const currentStatus = response.querySelector(".aie-status");
      if (currentStatus) {
        currentStatus.textContent = message.status;
      }
    } else if (message.type === "EXPLANATION_CHUNK" && typeof message.chunk === "string") {
      if (response.querySelector(".aie-status")) {
        response.replaceChildren();
      }
      renderMarkdown(response, (response.dataset.markdown || "") + message.chunk);
      response.dataset.markdown = (response.dataset.markdown || "") + message.chunk;
      response.setAttribute("aria-busy", "true");
    } else if (message.type === "EXPLANATION_DONE") {
      response.setAttribute("aria-busy", "false");
      if (!response.dataset.markdown) {
        showError(requestId, "The provider returned an empty explanation.");
      }
    } else if (message.type === "EXPLANATION_ERROR" && typeof message.error === "string") {
      showError(requestId, message.error);
    } else if (message.type === "EXPLANATION_SETUP_REQUIRED") {
      showSetupNotice();
    }
  });

  function renderMarkdown(container, markdown) {
    container.replaceChildren();
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    let index = 0;

    while (index < lines.length) {
      if (lines[index].startsWith("```")) {
        index += 1;
        const codeLines = [];
        while (index < lines.length && !lines[index].startsWith("```")) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          index += 1;
        }
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.append(code);
        container.append(pre);
        continue;
      }

      if (!lines[index].trim()) {
        index += 1;
        continue;
      }

      const paragraphLines = [];
      while (index < lines.length && lines[index].trim() && !lines[index].startsWith("```")) {
        paragraphLines.push(lines[index]);
        index += 1;
      }
      const paragraph = document.createElement("p");
      paragraphLines.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
          paragraph.append(document.createElement("br"));
        }
        appendInlineMarkdown(paragraph, line);
      });
      container.append(paragraph);
    }
  }

  function appendInlineMarkdown(parent, text) {
    const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let previousIndex = 0;
    let match;
    while ((match = tokenPattern.exec(text)) !== null) {
      parent.append(document.createTextNode(text.slice(previousIndex, match.index)));
      const token = match[0];
      const element = document.createElement(token.startsWith("**") ? "strong" : "code");
      element.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
      parent.append(element);
      previousIndex = tokenPattern.lastIndex;
    }
    parent.append(document.createTextNode(text.slice(previousIndex)));
  }

  function showError(id, message) {
    if (id !== requestId) {
      return;
    }
    setupNotice.hidden = true;
    response.replaceChildren();
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "false");
    const error = document.createElement("p");
    error.className = "aie-error";
    error.textContent = message;
    response.append(error);
  }

  function showSetupNotice() {
    response.replaceChildren();
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "false");
    setupNotice.hidden = false;
  }

  function positionPanel(x, y) {
    const width = Math.min(390, window.innerWidth - 24);
    const height = Math.min(540, window.innerHeight - 24);
    const left = Math.max(12, Math.min(x, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(y, window.innerHeight - height - 12));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function positionElement(element, x, y, width, height) {
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  }

  function cancelCurrentRequest() {
    if (requestId) {
      void chrome.runtime.sendMessage({ type: "CANCEL_EXPLANATION", requestId });
      requestId = "";
    }
  }

  function createRequestId() {
    return crypto.randomUUID();
  }
})();
