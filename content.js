(() => {
  const MAX_SELECTION_LENGTH = 20000;
  const CONTEXT_MARKERS = [
    { value: "[CONTEXT:LEARNING]", isLearning: true },
    { value: "[CONTEXT:GENERAL]", isLearning: false }
  ];
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
  const status = document.createElement("p");
  status.className = "aie-status";
  const spinner = document.createElement("span");
  spinner.className = "aie-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const statusText = document.createElement("span");
  statusText.className = "aie-status-text";
  const loadingDots = document.createElement("span");
  loadingDots.className = "aie-loading-dots";
  loadingDots.setAttribute("aria-hidden", "true");
  loadingDots.textContent = "•••";
  status.append(spinner, statusText, loadingDots);
  status.hidden = true;
  response.append(status);

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

  const actions = document.createElement("footer");
  actions.className = "aie-actions";
  const copyButton = document.createElement("button");
  copyButton.className = "aie-action-button";
  copyButton.type = "button";
  copyButton.textContent = "📋 Copy";
  copyButton.disabled = true;
  const retryButton = document.createElement("button");
  retryButton.className = "aie-action-button";
  retryButton.type = "button";
  retryButton.textContent = "🔄 Thử lại";
  const speakButton = document.createElement("button");
  speakButton.className = "aie-action-button aie-speak-button";
  speakButton.type = "button";
  speakButton.textContent = "🔊 Đọc lên";
  speakButton.setAttribute("aria-label", "Đọc nội dung giải thích");
  speakButton.hidden = true;
  const dismissButton = document.createElement("button");
  dismissButton.className = "aie-action-button aie-action-dismiss";
  dismissButton.type = "button";
  dismissButton.textContent = "❌ Đóng";
  const actionFeedback = document.createElement("span");
  actionFeedback.className = "aie-action-feedback";
  actionFeedback.setAttribute("aria-live", "polite");
  actions.append(copyButton, retryButton, speakButton, dismissButton, actionFeedback);

  panel.append(header, selectionPreview, setupNotice, response, actions);
  shadow.append(panel);

  let selectedText = "";
  let requestId = "";
  let isLearningContext = false;
  let isStreamComplete = false;
  let contextDecisionMade = false;
  let contextPrefixBuffer = "";
  let contextHeaderPending = false;
  let contextSkipLineFeed = false;
  let activeUtterance = null;
  let copyFeedbackTimer;
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

  launcher.addEventListener("click", () => {
    void startExplanation();
  });

  retryButton.addEventListener("click", () => {
    void startExplanation();
  });

  copyButton.addEventListener("click", async () => {
    const text = getPlainResponseText();
    if (!text) {
      return;
    }

    try {
      await copyText(text);
      setCopyFeedback("✓ Đã copy!", false);
    } catch {
      setCopyFeedback("Không thể copy. Hãy thử lại.", true);
    }
  });

  speakButton.addEventListener("click", () => {
    if (activeUtterance) {
      stopSpeech();
      return;
    }
    if (isLearningContext && isStreamComplete) {
      speakText(getPlainResponseText(), "vi-VN");
    }
  });

  closeButton.addEventListener("click", closePanel);
  dismissButton.addEventListener("click", closePanel);

  async function startExplanation() {
    stopSpeech();
    isLearningContext = false;
    isStreamComplete = false;
    contextDecisionMade = false;
    contextPrefixBuffer = "";
    contextHeaderPending = false;
    contextSkipLineFeed = false;
    launcher.hidden = true;
    selectionPreview.textContent = selectedText.slice(0, 240);
    if (selectedText.length > 240) {
      selectionPreview.textContent += "…";
    }
    if (selectedText.length >= MAX_SELECTION_LENGTH) {
      selectionPreview.textContent += " (selection limited to 20,000 characters)";
    }
    setStatus("Đang kết nối với nhà cung cấp AI…");
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "true");
    copyButton.disabled = true;
    speakButton.hidden = true;
    setupNotice.hidden = true;
    actionFeedback.textContent = "";
    window.clearTimeout(copyFeedbackTimer);
    copyButton.textContent = "📋 Copy";
    positionPanel(pointer.x + 10, pointer.y + 10);
    panel.hidden = false;

    if (requestId) {
      void cancelRequest(requestId);
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
  }

  function closePanel() {
    stopSpeech();
    cancelCurrentRequest();
    panel.hidden = true;
    launcher.hidden = true;
  }

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
      if (response.contains(status)) {
        statusText.textContent = message.status;
      }
    } else if (
      (message.type === "EXPLANATION_CHUNK" || message.type === "streamChunk") &&
      typeof message.chunk === "string"
    ) {
      appendVisibleChunk(filterContextChunk(message.chunk));
    } else if (message.type === "EXPLANATION_DONE" || message.type === "streamDone") {
      appendVisibleChunk(finishContextFilter());
      response.setAttribute("aria-busy", "false");
      if (!response.dataset.markdown) {
        showError(requestId, "The provider returned an empty explanation.");
      } else {
        isStreamComplete = true;
        speakButton.hidden = !isLearningContext;
        if (isLearningContext) {
          renderMarkdown(response, response.dataset.markdown);
        }
      }
    } else if (message.type === "EXPLANATION_ERROR" && typeof message.error === "string") {
      showError(requestId, message.error);
    } else if (message.type === "EXPLANATION_SETUP_REQUIRED") {
      showSetupNotice();
    }
  });

  function filterContextChunk(chunk) {
    if (contextDecisionMade) {
      return stripContextLineBreak(chunk);
    }

    contextPrefixBuffer += chunk;
    const leadingWhitespace = contextPrefixBuffer.match(/^\uFEFF?[ \t]*/)[0].length;
    const markerCandidate = contextPrefixBuffer.slice(leadingWhitespace);
    const marker = CONTEXT_MARKERS.find(({ value }) => markerCandidate.startsWith(value));
    if (marker) {
      isLearningContext = marker.isLearning;
      contextDecisionMade = true;
      const remainder = contextPrefixBuffer.slice(leadingWhitespace + marker.value.length);
      contextPrefixBuffer = "";
      return stripContextLineBreak(remainder, true);
    }

    if (CONTEXT_MARKERS.some(({ value }) => value.startsWith(markerCandidate))) {
      return "";
    }

    contextDecisionMade = true;
    isLearningContext = false;
    const visibleText = contextPrefixBuffer.replace(/^\uFEFF/, "");
    contextPrefixBuffer = "";
    return visibleText;
  }

  function stripContextLineBreak(text, markerFound = false) {
    if (contextHeaderPending) {
      contextHeaderPending = false;
      const lineBreak = text.match(/^[ \t]*(\r\n|\r|\n)/);
      if (lineBreak) {
        if (lineBreak[1] === "\r" && text.length === lineBreak[0].length) {
          contextSkipLineFeed = true;
        }
        return text.slice(lineBreak[0].length);
      }
      if (/^[ \t]*$/.test(text)) {
        contextHeaderPending = true;
        return "";
      }
      return text;
    }

    if (contextSkipLineFeed) {
      contextSkipLineFeed = false;
      if (text.startsWith("\n")) {
        return text.slice(1);
      }
    }

    if (markerFound) {
      const lineBreak = text.match(/^[ \t]*(\r\n|\r|\n)/);
      if (lineBreak) {
        if (lineBreak[1] === "\r" && text.length === lineBreak[0].length) {
          contextSkipLineFeed = true;
        }
        return text.slice(lineBreak[0].length);
      }
      if (/^[ \t]*$/.test(text)) {
        contextHeaderPending = true;
        return "";
      }
    }

    return text;
  }

  function finishContextFilter() {
    if (!contextDecisionMade) {
      contextDecisionMade = true;
      isLearningContext = false;
      const visibleText = contextPrefixBuffer.replace(/^\uFEFF/, "");
      contextPrefixBuffer = "";
      contextHeaderPending = false;
      contextSkipLineFeed = false;
      return visibleText;
    }
    contextHeaderPending = false;
    contextSkipLineFeed = false;
    return "";
  }

  function appendVisibleChunk(chunk) {
    if (!chunk) {
      return;
    }
    if (response.contains(status)) {
      response.replaceChildren();
    }
    const markdown = (response.dataset.markdown || "") + chunk;
    const shouldStickToBottom =
      response.scrollHeight - response.scrollTop - response.clientHeight < 48;
    response.dataset.markdown = markdown;
    renderMarkdown(response, markdown);
    response.setAttribute("aria-busy", "true");
    copyButton.disabled = false;
    if (shouldStickToBottom) {
      response.scrollTop = response.scrollHeight;
    }
  }

  function getPlainResponseText() {
    const copyable = response.cloneNode(true);
    copyable.querySelectorAll(".inline-speaker").forEach((speaker) => speaker.remove());
    return (copyable.innerText || copyable.textContent || "").trim();
  }

  function speakText(text, language) {
    const Utterance = window.SpeechSynthesisUtterance;
    if (!text || !window.speechSynthesis || typeof Utterance !== "function") {
      actionFeedback.textContent = "Đọc văn bản không được hỗ trợ trong trình duyệt này.";
      actionFeedback.dataset.error = "true";
      return;
    }

    stopSpeech();
    try {
      const utterance = new Utterance(text);
      utterance.lang = language;
      utterance.onend = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
          speakButton.textContent = "🔊 Đọc lên";
          speakButton.setAttribute("aria-label", "Đọc nội dung giải thích");
        }
      };
      utterance.onerror = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
          speakButton.textContent = "🔊 Đọc lên";
          speakButton.setAttribute("aria-label", "Đọc nội dung giải thích");
          actionFeedback.textContent = "Không thể phát âm đoạn văn bản này.";
          actionFeedback.dataset.error = "true";
        }
      };
      activeUtterance = utterance;
      speakButton.textContent = "⏹ Dừng đọc";
      speakButton.setAttribute("aria-label", "Dừng đọc");
      window.speechSynthesis.speak(utterance);
    } catch {
      activeUtterance = null;
      speakButton.textContent = "🔊 Đọc lên";
      speakButton.setAttribute("aria-label", "Đọc nội dung giải thích");
      actionFeedback.textContent = "Không thể phát âm đoạn văn bản này.";
      actionFeedback.dataset.error = "true";
    }
  }

  function stopSpeech() {
    const synthesis = window.speechSynthesis;
    const wasSpeaking = activeUtterance !== null;
    activeUtterance = null;
    if (synthesis && wasSpeaking) {
      synthesis.cancel();
    }
    speakButton.textContent = "🔊 Đọc lên";
    speakButton.setAttribute("aria-label", "Đọc nội dung giải thích");
  }

  function createInlineSpeaker(text) {
    const speaker = document.createElement("span");
    speaker.className = "inline-speaker";
    speaker.setAttribute("role", "button");
    speaker.setAttribute("tabindex", "0");
    speaker.setAttribute("aria-label", `Đọc ví dụ: ${text.slice(0, 60)}`);
    speaker.textContent = "🔊";
    speaker.addEventListener("click", (event) => {
      event.stopPropagation();
      speakText(text, getExampleSpeechLanguage(text));
    });
    speaker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        speakText(text, getExampleSpeechLanguage(text));
      }
    });
    return speaker;
  }

  function getExampleSpeechLanguage(text) {
    if (/[\u3040-\u30ff]/.test(text)) {
      return "ja-JP";
    }
    if (/[\uac00-\ud7af]/.test(text)) {
      return "ko-KR";
    }
    if (/[\u3400-\u9fff]/.test(text) || /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(text)) {
      return "zh-CN";
    }
    return "en-US";
  }

  function renderMarkdown(container, markdown) {
    container.replaceChildren();
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    let index = 0;

    while (index < lines.length) {
      if (/^\s*```/.test(lines[index])) {
        index += 1;
        const codeLines = [];
        while (index < lines.length && !/^\s*```/.test(lines[index])) {
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

      const firstListItem = matchListItem(lines[index]);
      if (firstListItem) {
        const list = document.createElement("ul");
        let listItem = firstListItem;
        while (listItem) {
          const item = document.createElement("li");
          appendLearningLine(item, listItem.content);
          list.append(item);
          index += 1;
          listItem = index < lines.length ? matchListItem(lines[index]) : null;
        }
        container.append(list);
        continue;
      }

      const firstOrderedListItem = matchOrderedListItem(lines[index]);
      if (firstOrderedListItem) {
        const list = document.createElement("ol");
        if (Number(firstOrderedListItem[1]) !== 1) {
          list.start = Number(firstOrderedListItem[1]);
        }
        let listItem = firstOrderedListItem;
        while (listItem) {
          const item = document.createElement("li");
          appendLearningLine(item, listItem[2]);
          list.append(item);
          index += 1;
          listItem = index < lines.length ? matchOrderedListItem(lines[index]) : null;
        }
        container.append(list);
        continue;
      }

      if (!lines[index].trim()) {
        index += 1;
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^\s*```/.test(lines[index]) &&
        !matchListItem(lines[index]) &&
        !matchOrderedListItem(lines[index])
      ) {
        paragraphLines.push(lines[index]);
        index += 1;
      }
      const paragraph = document.createElement("p");
      paragraphLines.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
          paragraph.append(document.createElement("br"));
        }
        appendLearningLine(paragraph, line);
      });
      container.append(paragraph);
    }
  }

  function matchListItem(line) {
    const match = line.match(/^\s*([*+-])\s+(.*)$/);
    return match ? { content: match[2] } : null;
  }

  function matchOrderedListItem(line) {
    return line.match(/^\s*(\d+)\.\s+(.*)$/);
  }

  function appendLearningLine(parent, text) {
    const playableParts = isLearningContext ? getPlayableLineParts(text) : null;
    if (!playableParts) {
      appendInlineMarkdown(parent, text);
      return;
    }

    const line = document.createElement("span");
    line.className = "playable-line";
    const foreignContent = document.createElement("span");
    foreignContent.className = "playable-line-foreign";
    appendInlineMarkdown(foreignContent, playableParts.before);
    line.append(foreignContent);

    if (isStreamComplete) {
      line.append(createInlineSpeaker(playableParts.speechText));
    }

    if (playableParts.after) {
      const translation = document.createElement("span");
      translation.className = "playable-line-translation";
      appendInlineMarkdown(translation, playableParts.after);
      line.append(translation);
    }
    parent.append(line);
  }

  function getPlayableLineParts(text) {
    const samples = getForeignSamples(text);
    if (!samples.length) {
      return null;
    }

    const lastSample = samples[samples.length - 1];
    let boundary = lastSample.end;
    const markdownClosing = text.slice(boundary).match(/^(?:\*\*|\*|`)+/);
    if (markdownClosing) {
      boundary += markdownClosing[0].length;
    }
    const punctuation = text.slice(boundary).match(/^[,，。.!?！？、;；]/);
    if (punctuation) {
      boundary += punctuation[0].length;
    }

    return {
      before: text.slice(0, boundary),
      after: text.slice(boundary),
      speechText: samples.map((sample) => sample.text).join(" ")
    };
  }

  function getForeignSamples(text) {
    const pattern =
      /"[^"\r\n]+"|“[^”\r\n]+”|„[^“\r\n]+“|‘[^’\r\n]+’|«[^»\r\n]+»|「[^」\r\n]+」|『[^』\r\n]+』|\/[^/\r\n]{1,80}\/|[\u3040-\u30ff]+|[\uac00-\ud7af]+|[\u3400-\u9fff]+/g;
    const samples = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[0];
      if (token.startsWith("/") && !isSlashExample(text, match.index, token)) {
        continue;
      }
      const quoted = /^["“„‘«「『]/.test(token);
      const sampleText = getSpeechSample(token);
      if (quoted && (!isQuotedExample(token) || isLikelyVietnamese(sampleText))) {
        continue;
      }
      samples.push({
        start: match.index,
        end: match.index + token.length,
        text: sampleText
      });
    }
    return samples;
  }

  function isLikelyVietnamese(text) {
    const normalized = text.toLocaleLowerCase("vi");
    return /[ăâđêôơư]/u.test(normalized) ||
      /\b(?:xin chào|xin chao|nghĩa là|nghia la|có nghĩa|co nghia|dịch là|dich la|tiếng việt|tieng viet|tức là|tuc la)\b/u.test(normalized);
  }

  function appendInlineMarkdown(parent, text) {
    const tokenPattern =
      /(\*\*(.*?)\*\*|`[^`\r\n]+`|\*(?!\s)[^*\r\n]+\*|"[^"\r\n]+"|“[^”\r\n]+”|„[^“\r\n]+“|‘[^’\r\n]+’|«[^»\r\n]+»|「[^」\r\n]+」|『[^』\r\n]+』|\/[^/\r\n]{1,80}\/)/g;
    let previousIndex = 0;
    let previousWasExample = false;
    let match;
    while ((match = tokenPattern.exec(text)) !== null) {
      const prefix = text.slice(previousIndex, match.index);
      if (prefix) {
        parent.append(document.createTextNode(prefix));
        previousWasExample = false;
      }
      const token = match[0];
      if (token.startsWith("**")) {
        const bold = document.createElement("strong");
        appendInlineMarkdown(bold, token.slice(2, -2));
        parent.append(bold);
        previousWasExample = false;
      } else if (token.startsWith("*")) {
        const italic = document.createElement("em");
        appendInlineMarkdown(italic, token.slice(1, -1));
        parent.append(italic);
        previousWasExample = false;
      } else if (token.startsWith("`")) {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.append(code);
        previousWasExample = false;
      } else if (token.startsWith("/")
        ? isSlashExample(text, match.index, token)
        : isQuotedExample(token)) {
        const before = prefix[prefix.length - 1] || text[match.index - 1] || "";
        if (
          before &&
          !/\s/.test(before) &&
          !'([{“‘«「『'.includes(before) &&
          (prefix.length > 0 || !previousWasExample)
        ) {
          parent.append(document.createTextNode(" "));
        }
        const example = document.createElement("span");
        example.className = "aie-foreign-example";
        example.textContent = token;
        parent.append(example);
        const after = text[match.index + token.length] || "";
        if (after && !/\s/.test(after) && !'.,!?;:)]}”’»」』"'.includes(after)) {
          parent.append(document.createTextNode(" "));
        }
        previousWasExample = true;
      } else {
        parent.append(document.createTextNode(token));
        previousWasExample = false;
      }
      previousIndex = tokenPattern.lastIndex;
    }
    parent.append(document.createTextNode(text.slice(previousIndex)));
  }

  function getSpeechSample(token) {
    return token
      .replace(/^[/"“„‘«「『]/, "")
      .replace(/[/"”’»」』"]$/, "")
      .trim();
  }

  function isQuotedExample(token) {
    return !/^(?:https?:\/\/|www\.)/i.test(token.slice(1, -1).trim());
  }

  function isSlashExample(text, index, token) {
    const content = token.slice(1, -1);
    const before = text[index - 1] || "";
    const after = text[index + token.length] || "";
    const startBoundary = !before || /\s/.test(before) || '([{“‘«「『"”’»」』'.includes(before);
    const endBoundary = !after || /\s/.test(after) || '.,!?;:)]}”’»」』"'.includes(after);

    return startBoundary && endBoundary && /[\p{L}\p{M}]/u.test(content);
  }

  function showError(id, message) {
    if (id !== requestId) {
      return;
    }
    stopSpeech();
    isLearningContext = false;
    isStreamComplete = false;
    speakButton.hidden = true;
    setupNotice.hidden = true;
    response.replaceChildren();
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "false");
    copyButton.disabled = true;
    const error = document.createElement("p");
    error.className = "aie-error";
    error.textContent = message;
    response.append(error);
  }

  function showSetupNotice() {
    stopSpeech();
    isLearningContext = false;
    isStreamComplete = false;
    speakButton.hidden = true;
    response.replaceChildren();
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "false");
    setupNotice.hidden = false;
    copyButton.disabled = true;
  }

  function setStatus(message) {
    statusText.textContent = message;
    status.hidden = false;
    response.replaceChildren(status);
  }

  function setCopyFeedback(message, isError) {
    actionFeedback.textContent = message;
    actionFeedback.dataset.error = String(isError);
    copyButton.textContent = isError ? "📋 Copy" : message;
    window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = window.setTimeout(() => {
      actionFeedback.textContent = "";
      actionFeedback.dataset.error = "false";
      copyButton.textContent = "📋 Copy";
    }, 2000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("aria-hidden", "true");
      textarea.tabIndex = -1;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      shadow.append(textarea);
      let copied = false;
      try {
        textarea.select();
        copied = document.execCommand("copy");
      } finally {
        textarea.remove();
      }
      if (copied) {
        return;
      }
      throw error;
    }
  }

  async function cancelRequest(id) {
    try {
      await chrome.runtime.sendMessage({ type: "CANCEL_EXPLANATION", requestId: id });
    } catch {
      // The service worker may already have stopped the request.
    }
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
      void cancelRequest(requestId);
      requestId = "";
    }
  }

  function createRequestId() {
    return crypto.randomUUID();
  }
})();
