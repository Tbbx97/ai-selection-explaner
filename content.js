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
  launcher.id = "ai-explain-btn";
  launcher.type = "button";
  launcher.setAttribute("aria-hidden", "true");
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

  const imageActions = document.createElement("div");
  imageActions.className = "aie-image-actions";
  imageActions.hidden = true;
  const cropImageButton = document.createElement("button");
  cropImageButton.className = "aie-image-action-button";
  cropImageButton.type = "button";
  cropImageButton.textContent = "✂️ Crop vùng ảnh này";
  imageActions.append(cropImageButton);
  shadow.append(imageActions);

  const cropOverlay = document.createElement("div");
  cropOverlay.className = "aie-crop-overlay";
  cropOverlay.hidden = true;
  cropOverlay.tabIndex = 0;
  cropOverlay.setAttribute("role", "application");
  cropOverlay.setAttribute("aria-label", "Drag to select an area to explain. Press Escape to cancel.");
  const cropSelection = document.createElement("div");
  cropSelection.className = "aie-crop-selection";
  cropSelection.hidden = true;
  cropOverlay.append(cropSelection);
  shadow.append(cropOverlay);

  const panel = document.createElement("section");
  panel.className = "aie-panel";
  panel.id = "ai-explain-popup-root";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI explanation");
  panel.setAttribute("aria-hidden", "true");
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
  setupText.textContent = "No AI API key is configured.";
  const setupLink = document.createElement("button");
  setupLink.className = "aie-setup-link";
  setupLink.type = "button";
  setupLink.textContent = "Click here for the 1-minute guide to getting a free API key";
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
  retryButton.textContent = "🔄 Retry";
  const speakButton = document.createElement("button");
  speakButton.className = "aie-action-button aie-speak-button";
  speakButton.type = "button";
  speakButton.textContent = "🔊 Read aloud";
  speakButton.setAttribute("aria-label", "Read the explanation aloud");
  speakButton.hidden = true;
  const dismissButton = document.createElement("button");
  dismissButton.className = "aie-action-button aie-action-dismiss";
  dismissButton.type = "button";
  dismissButton.textContent = "❌ Close";
  const actionFeedback = document.createElement("span");
  actionFeedback.className = "aie-action-feedback";
  actionFeedback.setAttribute("aria-live", "polite");
  actions.append(copyButton, retryButton, speakButton, dismissButton, actionFeedback);

  panel.append(header, selectionPreview, setupNotice, response, actions);
  shadow.append(panel);

  let selectedText = "";
  let selectionRect = null;
  let selectionIdentity = null;
  let hasExplained = false;
  let isContentVisible = true;
  let requestId = "";
  let panelAnchor = null;
  let panelAttachedToSelection = false;
  let isLearningContext = false;
  let isStreamComplete = false;
  let contextDecisionMade = false;
  let contextPrefixBuffer = "";
  let contextHeaderPending = false;
  let contextSkipLineFeed = false;
  let activeUtterance = null;
  let speechRunId = 0;
  let panelDrag = null;
  let copyFeedbackTimer;
  let activeImage = null;
  let hideImageActionsTimer;
  let cropStart = null;
  let cropRectangle = null;
  let lastRequest = null;
  let pointer = { x: 0, y: 0 };
  let isCropModeActive = false;
  const visibilityTimers = new Map();

  document.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });

  document.addEventListener("mousemove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (panelDrag) {
      movePanelDrag(event);
      return;
    }
    updateSelectionVisibility(event);
  }, { passive: true });

  header.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.composedPath().includes(closeButton)) {
      return;
    }
    startPanelDrag(event);
  });

  document.addEventListener("mouseup", () => {
    if (panelDrag) {
      endPanelDrag();
    }
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host)) {
      return;
    }
    pointer = { x: event.clientX, y: event.clientY };
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (text.length <= 5) {
        return;
      }
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const nextRect = range?.getBoundingClientRect();
      if (!nextRect || (!nextRect.width && !nextRect.height)) {
        return;
      }

      if (isDifferentSelection(text, selection)) {
        resetForNewSelection();
      }
      selectedText = text.slice(0, MAX_SELECTION_LENGTH);
      selectionRect = nextRect;
      selectionIdentity = {
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset
      };
      isContentVisible = true;
      showSelectionContent();
    }, 0);
  }, true);

  document.addEventListener("pointerover", (event) => {
    const target = event.target;
    if (target?.tagName !== "IMG" || host.contains(target)) {
      return;
    }
    showImageActions(target);
  }, true);

  document.addEventListener("pointerout", (event) => {
    if (event.target === activeImage && event.relatedTarget !== activeImage) {
      scheduleHideImageActions();
    }
  }, true);

  imageActions.addEventListener("pointerenter", () => {
    window.clearTimeout(hideImageActionsTimer);
    imageActions.classList.remove("is-hiding");
  });
  imageActions.addEventListener("pointerleave", scheduleHideImageActions);
  cropImageButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startCropMode();
  });
  cropOverlay.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target !== cropOverlay) {
      return;
    }
    event.preventDefault();
    cropOverlay.classList.add("is-selecting");
    cropStart = { x: event.clientX, y: event.clientY };
    cropRectangle = { left: event.clientX, top: event.clientY, width: 0, height: 0 };
    updateCropSelection();
  });
  cropOverlay.addEventListener("mousemove", (event) => {
    if (!cropStart) {
      return;
    }
    cropRectangle = getCropRectangle(cropStart, { x: event.clientX, y: event.clientY });
    updateCropSelection();
  });
  cropOverlay.addEventListener("mouseup", (event) => {
    if (!cropStart) {
      return;
    }
    cropRectangle = getCropRectangle(cropStart, { x: event.clientX, y: event.clientY });
    const completedRectangle = cropRectangle;
    cropStart = null;
    cropRectangle = null;
    cropSelection.hidden = true;
    cropOverlay.classList.remove("is-selecting");
    cropOverlay.hidden = true;
    isCropModeActive = false;
    if (completedRectangle.width >= 8 && completedRectangle.height >= 8) {
      void captureAndExplainCrop(completedRectangle, { x: event.clientX, y: event.clientY });
    } else {
      updateSelectionVisibility({ clientX: pointer.x, clientY: pointer.y });
    }
  });
  cropOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelCropMode();
    }
  });

  launcher.addEventListener("click", () => {
    void startExplanation();
  });

  retryButton.addEventListener("click", () => {
    retryLastExplanation();
  });

  copyButton.addEventListener("click", async () => {
    const text = getPlainResponseText();
    if (!text) {
      return;
    }

    try {
      await copyText(text);
      setCopyFeedback("✓ Copied!", false);
    } catch {
      setCopyFeedback("Could not copy. Please try again.", true);
    }
  });

  speakButton.addEventListener("click", () => {
    if (activeUtterance) {
      stopSpeech();
      return;
    }
    if (isLearningContext && isStreamComplete && hasSpeakableLearningLine()) {
      speakSegments(getReadAloudSegments());
    }
  });

  closeButton.addEventListener("click", closePanel);
  dismissButton.addEventListener("click", closePanel);

  async function startExplanation() {
    const text = selectedText;
    lastRequest = { type: "text", text };
    const nextRequestId = createRequestId();
    prepareExplanationRequest(
      nextRequestId,
      text,
      "Connecting to the AI provider…",
      getSelectionPanelAnchor()
    );

    try {
      const providerStatus = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_STATUS" });
      if (requestId !== nextRequestId) {
        return;
      }
      if (!providerStatus?.ok) {
        showError(nextRequestId, providerStatus?.error || "Could not check your saved AI key.");
        return;
      }
      if (!providerStatus.hasKey) {
        showSetupNotice();
        return;
      }

      const result = await chrome.runtime.sendMessage({
        type: "EXPLAIN_SELECTION",
        requestId: nextRequestId,
        text
      });
      if (!result?.ok) {
        showError(nextRequestId, result?.error || "Could not start the explanation request.");
      }
    } catch {
      showError(nextRequestId, "Could not contact the extension service worker. Reload the extension and try again.");
    }
  }

  function prepareExplanationRequest(nextRequestId, previewText, initialStatus, anchor) {
    stopSpeech();
    isLearningContext = false;
    isStreamComplete = false;
    contextDecisionMade = false;
    contextPrefixBuffer = "";
    contextHeaderPending = false;
    contextSkipLineFeed = false;
    imageActions.hidden = true;
    cropOverlay.hidden = true;
    setWidgetVisible(launcher, false, true);
    selectionPreview.textContent = previewText.slice(0, 240);
    if (previewText.length > 240) {
      selectionPreview.textContent += "…";
    }
    if (previewText.length >= MAX_SELECTION_LENGTH) {
      selectionPreview.textContent += " (selection limited to 20,000 characters)";
    }
    setStatus(initialStatus);
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "true");
    copyButton.disabled = true;
    retryButton.disabled = false;
    speakButton.hidden = true;
    setupNotice.hidden = true;
    actionFeedback.textContent = "";
    window.clearTimeout(copyFeedbackTimer);
    copyButton.textContent = "📋 Copy";
    panelAnchor = { x: anchor.x, y: anchor.y };
    panelAttachedToSelection = lastRequest?.type === "text" && Boolean(selectionRect);
    isContentVisible = true;
    setWidgetVisible(panel, true);
    positionPanel(
      anchor.x,
      anchor.y,
      panelAttachedToSelection ? selectionRect : null
    );

    if (requestId) {
      void cancelRequest(requestId);
    }
    requestId = nextRequestId;
  }

  function startImageExplanation(source, anchor) {
    const nextRequestId = createRequestId();
    lastRequest = { type: "image", ...source };
    prepareExplanationRequest(
      nextRequestId,
      source.imageDataUrl ? "Cropped screen area" : "Image",
      "Preparing image for AI analysis…",
      anchor
    );
    sendImageRequest(source, nextRequestId);
  }

  function retryLastExplanation() {
    hasExplained = true;
    if (!lastRequest) {
      void startExplanation();
      return;
    }
    if (lastRequest.type === "text") {
      selectedText = lastRequest.text;
      void startExplanation();
      return;
    }
    startImageExplanation(
      { imageDataUrl: lastRequest.imageDataUrl },
      { x: pointer.x, y: pointer.y }
    );
  }

  function closePanel() {
    stopSpeech();
    cancelCurrentRequest();
    selectedText = "";
    selectionRect = null;
    selectionIdentity = null;
    hasExplained = false;
    isContentVisible = false;
    panelAnchor = null;
    panelAttachedToSelection = false;
    lastRequest = null;
    window.getSelection()?.removeAllRanges();
    setWidgetVisible(panel, false, true);
    setWidgetVisible(launcher, false, true);
    selectionPreview.textContent = "";
    response.replaceChildren(status);
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "false");
    status.hidden = true;
    setupNotice.hidden = true;
    copyButton.disabled = true;
    retryButton.disabled = true;
    speakButton.hidden = true;
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
    if (message?.action === "startGlobalCrop") {
      startCropMode();
      return;
    }
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
      hasExplained = true;
      updateSelectionVisibility({ clientX: pointer.x, clientY: pointer.y });
      appendVisibleChunk(filterContextChunk(message.chunk));
    } else if (message.type === "EXPLANATION_DONE" || message.type === "streamDone") {
      appendVisibleChunk(finishContextFilter());
      response.setAttribute("aria-busy", "false");
      if (!response.dataset.markdown) {
        showError(requestId, "The provider returned an empty explanation.");
      } else {
        isStreamComplete = true;
        if (isLearningContext) {
          renderMarkdown(response, response.dataset.markdown);
        }
        speakButton.hidden = !hasSpeakableLearningLine();
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
    if (!hasExplained) {
      hasExplained = true;
      updateSelectionVisibility({ clientX: pointer.x, clientY: pointer.y });
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

  function hasSpeakableLearningLine() {
    return Boolean(response.querySelector(".playable-line .inline-speaker"));
  }

  function getBrowserSpeechLanguage() {
    const preferredLanguages = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
      chrome.i18n.getUILanguage()
    ];
    for (const language of preferredLanguages) {
      if (typeof language !== "string" || !language.trim()) {
        continue;
      }
      try {
        return new Intl.Locale(language).toString();
      } catch {
        continue;
      }
    }
    return "en-US";
  }

  function speakText(text, langCode) {
    speakSegments([{ text, language: langCode }]);
  }

  function speakSegments(segments) {
    const Utterance = window.SpeechSynthesisUtterance;
    const speakableSegments = segments
      .map((segment) => ({
        text: cleanTextForSpeech(segment.text),
        language: segment.language || getBrowserSpeechLanguage()
      }))
      .filter((segment) => segment.text);
    if (!speakableSegments.length || !window.speechSynthesis || typeof Utterance !== "function") {
      actionFeedback.textContent = "Read-aloud is not supported in this browser.";
      actionFeedback.dataset.error = "true";
      return;
    }

    stopSpeech();
    const currentRunId = speechRunId;
    speakButton.textContent = "⏹ Stop reading";
    speakButton.setAttribute("aria-label", "Stop reading");
    void playSpeechSegments(speakableSegments, currentRunId);
  }

  async function playSpeechSegments(segments, runId) {
    try {
      for (const segment of segments) {
        if (runId !== speechRunId) {
          return;
        }
        await speakUtterance(segment.text, segment.language, runId);
      }
      if (runId === speechRunId) {
        activeUtterance = null;
        speakButton.textContent = "🔊 Read aloud";
        speakButton.setAttribute("aria-label", "Read the explanation aloud");
      }
    } catch {
      if (runId === speechRunId) {
        activeUtterance = null;
        speakButton.textContent = "🔊 Read aloud";
        speakButton.setAttribute("aria-label", "Read the explanation aloud");
        actionFeedback.textContent = "Could not read this text aloud.";
        actionFeedback.dataset.error = "true";
      }
    }
  }

  async function speakUtterance(text, language, runId) {
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = language;
    activeUtterance = utterance;

    const voices = await getVoicesWhenReady();
    if (runId !== speechRunId || activeUtterance !== utterance) {
      return;
    }
    const voice = selectSpeechVoice(voices, language);
    if (voice) {
      utterance.voice = voice;
    }

    await new Promise((resolve, reject) => {
      utterance.onend = () => {
        if (activeUtterance === utterance) {
          activeUtterance = null;
        }
        resolve();
      };
      utterance.onerror = (event) => {
        if (runId !== speechRunId || activeUtterance !== utterance) {
          resolve();
          return;
        }
        activeUtterance = null;
        reject(new Error(event.error || "Speech synthesis failed."));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  function getVoicesWhenReady() {
    const synthesis = window.speechSynthesis;
    const voices = synthesis.getVoices();
    if (voices.length) {
      return Promise.resolve(voices);
    }

    return new Promise((resolve) => {
      let timeoutId;
      const finish = (availableVoices) => {
        synthesis.removeEventListener("voiceschanged", handleVoicesChanged);
        window.clearTimeout(timeoutId);
        resolve(availableVoices);
      };
      const handleVoicesChanged = () => {
        const availableVoices = synthesis.getVoices();
        if (availableVoices.length) {
          finish(availableVoices);
        }
      };

      synthesis.addEventListener("voiceschanged", handleVoicesChanged);
      timeoutId = window.setTimeout(() => finish(synthesis.getVoices()), 2000);
      handleVoicesChanged();
    });
  }

  function selectSpeechVoice(voices, language) {
    const normalizedLanguage = language.toLowerCase().replace(/_/g, "-");
    const languageCode = normalizedLanguage.split("-")[0];
    const languageVoices = voices.filter((voice) =>
      typeof voice.lang === "string" &&
      voice.lang.toLowerCase().replace(/_/g, "-").split("-")[0] === languageCode
    );
    const exactVoice = languageVoices.find((voice) =>
      voice.lang.toLowerCase().replace(/_/g, "-") === normalizedLanguage
    );
    const namedVoice = (pattern) =>
      languageVoices.find((voice) => pattern.test(voice.name));
    const naturalVoice = namedVoice(/natural|neural|premium|enhanced|wavenet/i);

    if (languageCode === "zh") {
      const isTraditionalChinese = /(?:-tw|-hk|hant)/i.test(normalizedLanguage);
      const regionalVoice = isTraditionalChinese
        ? namedVoice(/google.*國語|國語.*google/i)
        : namedVoice(/google.*普通话|普通话.*google/i);
      return regionalVoice ||
        naturalVoice ||
        namedVoice(/google.*(?:普通话|國語)|(?:普通话|國語).*google/i) ||
        exactVoice ||
        languageVoices[0] ||
        null;
    }

    if (languageCode === "en") {
      const prefersBritish = /-(?:gb|uk)(?:-|$)/i.test(normalizedLanguage);
      const googleVoice = prefersBritish
        ? namedVoice(/google\s*uk english/i)
        : namedVoice(/google\s*us english/i);
      return googleVoice || naturalVoice || exactVoice || languageVoices[0] || null;
    }

    return naturalVoice || exactVoice || languageVoices[0] || null;
  }

  function cleanTextForSpeech(text) {
    return typeof text === "string"
      ? text.replace(/\/.*?\//g, "").replace(/\s+/g, " ").trim()
      : "";
  }

  function stopSpeech() {
    const synthesis = window.speechSynthesis;
    const wasSpeaking = activeUtterance !== null;
    speechRunId += 1;
    activeUtterance = null;
    if (synthesis && wasSpeaking) {
      synthesis.cancel();
    }
    speakButton.textContent = "🔊 Read aloud";
    speakButton.setAttribute("aria-label", "Read the explanation aloud");
  }

  function getReadAloudSegments() {
    const userLanguage = getBrowserSpeechLanguage();
    const segments = [];
    const blockTags = new Set(["DIV", "LI", "OL", "P", "PRE", "UL"]);

    function appendText(text, language) {
      if (!text) {
        return;
      }
      const previous = segments[segments.length - 1];
      if (previous?.language === language) {
        previous.text += text;
        return;
      }
      segments.push({ text, language });
    }

    function visit(node, language = userLanguage) {
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node.nodeValue, language);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.classList.contains("inline-speaker")) {
        return;
      }
      if (node.tagName === "BR") {
        appendText("\n", language);
        return;
      }

      const isBlock = blockTags.has(node.tagName);
      if (isBlock && segments.length) {
        appendText("\n", language);
      }
      const childLanguage =
        node.classList.contains("playable-line-foreign") ||
        node.classList.contains("aie-foreign-example")
        ? getExampleSpeechLanguage(node.textContent)
        : language;
      node.childNodes.forEach((child) => visit(child, childLanguage));
      if (isBlock) {
        appendText("\n", language);
      }
    }

    response.childNodes.forEach((child) => visit(child));
    return segments
      .map((segment) => ({ ...segment, text: segment.text.trim() }))
      .filter((segment) => segment.text);
  }

  function createInlineSpeaker(text) {
    const speaker = document.createElement("span");
    speaker.className = "inline-speaker";
    speaker.setAttribute("role", "button");
    speaker.setAttribute("tabindex", "0");
    speaker.setAttribute("aria-label", `Read example aloud: ${text.slice(0, 60)}`);
    speaker.textContent = "🔊";
    speaker.addEventListener("click", (event) => {
      event.stopPropagation();
      speakPlayableLine(speaker, text);
    });
    speaker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        speakPlayableLine(speaker, text);
      }
    });
    return speaker;
  }

  function speakPlayableLine(speaker, fallbackText) {
    const line = speaker.closest(".playable-line");
    const foreignPhrase = line?.querySelector(".playable-line-foreign")?.innerText || fallbackText;
    let cleanLine = fallbackText;
    if (line) {
      const clone = line.cloneNode(true);
      clone.querySelectorAll(".inline-speaker").forEach((control) => control.remove());
      cleanLine = clone.innerText || clone.textContent || "";
    }
    const cleanedText = cleanTextForSpeech(cleanLine);
    if (cleanedText) {
      speakText(cleanedText, getExampleSpeechLanguage(foreignPhrase));
    }
  }

  function getExampleSpeechLanguage(text) {
    if (/[\u3040-\u30ff]/.test(text)) {
      return "ja-JP";
    }
    if (/[\uac00-\ud7af]/.test(text)) {
      return "ko-KR";
    }
    if (/[\u3400-\u9fff]/.test(text) || /[ǎǐǒǔǚǖ]/i.test(text)) {
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
    const translationMatch = /\s+(?:—|–|->|→|=)\s+/.exec(text);
    const translationIndex = translationMatch ? translationMatch.index : -1;
    const foreignText = translationIndex === -1 ? text : text.slice(0, translationIndex);
    const samples = getForeignSamples(foreignText, translationIndex !== -1);
    if (!samples.length) {
      return null;
    }

    const lastSample = samples[samples.length - 1];
    let boundary = lastSample.end;
    const markdownClosing = foreignText.slice(boundary).match(/^(?:\*\*|\*|`)+/);
    if (markdownClosing) {
      boundary += markdownClosing[0].length;
    }
    const punctuation = foreignText.slice(boundary).match(/^[,，。.!?！？、;；]/);
    if (punctuation) {
      boundary += punctuation[0].length;
    }

    return {
      before: foreignText.slice(0, boundary),
      after: text.slice(boundary),
      speechText: [...new Set(samples.map((sample) => sample.text))].join(" ")
    };
  }

  function getForeignSamples(text, hasTranslation) {
    const pattern =
      /"[^"\r\n]+"|“[^”\r\n]+”|„[^“\r\n]+“|‘[^’\r\n]+’|«[^»\r\n]+»|「[^」\r\n]+」|『[^』\r\n]+』|\*\*[^*\r\n]+\*\*|\/[^/\r\n]{1,80}\/|[\u3040-\u30ff]+|[\uac00-\ud7af]+|[\u3400-\u9fff]+|[A-Za-z]*[ǎǐǒǔǚǖ]+[A-Za-z]*/gi;
    const samples = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[0];
      const sampleText = getSpeechSample(token);
      const isCjk = /[\u3040-\u30ff\uac00-\ud7af\u3400-\u9fff]/.test(token);
      const isPinyin = /[ǎǐǒǔǚǖ]/i.test(token);
      const isQuoted = /^["“„‘«「『]/.test(token);
      const isMarkedTerm = /^\*\*/.test(token) && hasTranslation;
      const isPronunciation = token.startsWith("/") &&
        isSlashExample(text, match.index, token) &&
        isPhoneticText(sampleText);

      if (
        !sampleText ||
        (!isCjk && !isPinyin && !isPronunciation && !(isQuoted && hasTranslation) && !isMarkedTerm)
      ) {
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

  function isPhoneticText(text) {
    return /[ǎǐǒǔǚǖˈˌːəɪʊæɑɒʌɜθðʃʒŋɹɾɡɕɥɻɲç]/i.test(text);
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
      .replace(/^\*\*|\*\*$/g, "")
      .replace(/^`|`$/g, "")
      .replace(/^[/"“„‘«「『]/, "")
      .replace(/[/"”’»」』“"]$/, "")
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

  function isDifferentSelection(text, selection) {
    if (!selectedText || !selectionIdentity || text !== selectedText || lastRequest?.type === "image") {
      return true;
    }
    return selection.anchorNode !== selectionIdentity.anchorNode ||
      selection.anchorOffset !== selectionIdentity.anchorOffset ||
      selection.focusNode !== selectionIdentity.focusNode ||
      selection.focusOffset !== selectionIdentity.focusOffset;
  }

  function resetForNewSelection() {
    stopSpeech();
    cancelCurrentRequest();
    selectionRect = null;
    selectionIdentity = null;
    hasExplained = false;
    isContentVisible = true;
    panelAnchor = null;
    panelAttachedToSelection = false;
    lastRequest = null;
    isLearningContext = false;
    isStreamComplete = false;
    setWidgetVisible(panel, false, true);
    setWidgetVisible(launcher, false, true);
    selectionPreview.textContent = "";
    response.replaceChildren(status);
    response.dataset.markdown = "";
    response.setAttribute("aria-busy", "false");
    status.hidden = true;
    setupNotice.hidden = true;
    copyButton.disabled = true;
    retryButton.disabled = true;
    speakButton.hidden = true;
    actionFeedback.textContent = "";
  }

  function getSelectionPanelAnchor() {
    if (selectionRect) {
      return { x: selectionRect.left, y: selectionRect.bottom };
    }
    return { x: pointer.x + 10, y: pointer.y + 10 };
  }

  function showSelectionContent() {
    if (hasExplained || requestId) {
      setWidgetVisible(launcher, false, true);
      if (!panelAnchor) {
        panelAnchor = getSelectionPanelAnchor();
        panelAttachedToSelection = Boolean(selectionRect);
      }
      setWidgetVisible(panel, true);
      if (panelAttachedToSelection && selectionRect) {
        panelAnchor = getSelectionPanelAnchor();
        positionPanel(panelAnchor.x, panelAnchor.y, selectionRect);
      } else {
        positionPanel(panelAnchor.x, panelAnchor.y);
      }
      return;
    }

    setWidgetVisible(panel, false, true);
    const launcherPosition = getSelectionLauncherPosition();
    positionElement(launcher, launcherPosition.x, launcherPosition.y, 48, 48);
    setWidgetVisible(launcher, true);
  }

  function getSelectionLauncherPosition() {
    const width = 48;
    const gap = 8;
    let x = selectionRect.right + gap;
    if (x + width > window.innerWidth - 8) {
      x = selectionRect.left - width - gap;
    }
    return { x, y: selectionRect.top };
  }

  function isMouseInsideElement(event, element) {
    if (!element || element.hidden) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const insideX = event.clientX >= rect.left && event.clientX <= rect.right;
    const insideY = event.clientY >= rect.top && event.clientY <= rect.bottom;
    return insideX && insideY;
  }

  function updateSelectionVisibility(event) {
    if (!selectionRect || !selectedText || isCropModeActive || lastRequest?.type === "image") {
      return;
    }
    const isInsidePanel = isMouseInsideElement(event, panel);
    const isInsideLauncher = isMouseInsideElement(event, launcher);
    const isOverSelection = isMouseTrulyOverSelection(event);
    if (
      isOverSelection &&
      !isInsidePanel &&
      !isInsideLauncher &&
      panelAttachedToSelection &&
      !panel.hidden &&
      selectionRect
    ) {
      panelAnchor = getSelectionPanelAnchor();
      positionPanel(panelAnchor.x, panelAnchor.y, selectionRect);
    }

    const isInside = isOverSelection || isInsidePanel || isInsideLauncher;
    if (!isInside && isContentVisible) {
      isContentVisible = false;
      const currentWidget = hasExplained || requestId ? panel : launcher;
      setWidgetVisible(currentWidget, false);
      return;
    }

    if (isInside && !isContentVisible) {
      isContentVisible = true;
      showSelectionContent();
    }
  }

  function isMouseTrulyOverSelection(event) {
    const elementUnderMouse = document.elementFromPoint(event.clientX, event.clientY);
    if (!elementUnderMouse) {
      return false;
    }

    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 && !selection.isCollapsed
      ? selection.getRangeAt(0)
      : null;
    if (range) {
      const currentRect = range.getBoundingClientRect();
      if (currentRect.width || currentRect.height) {
        selectionRect = currentRect;
      }
    }

    if (isMouseInsideElement(event, panel) || isMouseInsideElement(event, launcher)) {
      return true;
    }
    if (!range || elementUnderMouse === host || host.contains(elementUnderMouse)) {
      return false;
    }

    const node = range.commonAncestorContainer;
    const parentNode = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
    if (!parentNode || typeof parentNode.contains !== "function") {
      return false;
    }

    const currentRects = range.getClientRects();
    for (let index = 0; index < currentRects.length; index += 1) {
      const rect = currentRects[index];
      if (
        event.clientX >= rect.left - 5 &&
        event.clientX <= rect.right + 5 &&
        event.clientY >= rect.top - 5 &&
        event.clientY <= rect.bottom + 5 &&
        (parentNode.contains(elementUnderMouse) || elementUnderMouse.contains(parentNode))
      ) {
        return true;
      }
    }
    return false;
  }

  function setWidgetVisible(element, visible, immediate = false) {
    window.clearTimeout(visibilityTimers.get(element));
    visibilityTimers.delete(element);
    if (visible) {
      const needsReveal = element.hidden || element.classList.contains("aie-selection-fading");
      element.hidden = false;
      element.setAttribute("aria-hidden", "false");
      if (!needsReveal) {
        return;
      }
      element.classList.add("aie-selection-fading");
      window.requestAnimationFrame(() => {
        if (!element.hidden) {
          element.classList.remove("aie-selection-fading");
        }
      });
      return;
    }

    element.setAttribute("aria-hidden", "true");
    if (immediate) {
      element.hidden = true;
      element.classList.remove("aie-selection-fading");
      return;
    }
    if (element.hidden) {
      return;
    }

    element.classList.add("aie-selection-fading");
    const timer = window.setTimeout(() => {
      if (element.classList.contains("aie-selection-fading")) {
        element.hidden = true;
      }
      visibilityTimers.delete(element);
    }, 160);
    visibilityTimers.set(element, timer);
  }

  function showImageActions(image) {
    if (!image.isConnected) {
      return;
    }
    activeImage = image;
    window.clearTimeout(hideImageActionsTimer);
    imageActions.classList.remove("is-hiding");
    const bounds = image.getBoundingClientRect();
    if (bounds.width < 24 || bounds.height < 24) {
      imageActions.hidden = true;
      return;
    }
    imageActions.hidden = false;
    const actionsBounds = imageActions.getBoundingClientRect();
    positionElement(
      imageActions,
      bounds.right - actionsBounds.width - 8,
      bounds.top + 8,
      actionsBounds.width,
      actionsBounds.height
    );
  }

  function scheduleHideImageActions() {
    window.clearTimeout(hideImageActionsTimer);
    hideImageActionsTimer = window.setTimeout(() => {
      imageActions.classList.add("is-hiding");
      hideImageActionsTimer = window.setTimeout(() => {
        imageActions.hidden = true;
        imageActions.classList.remove("is-hiding");
        activeImage = null;
      }, 160);
    }, 180);
  }

  function startCropMode() {
    window.clearTimeout(hideImageActionsTimer);
    stopSpeech();
    cancelCurrentRequest();
    imageActions.hidden = true;
    activeImage = null;
    isContentVisible = false;
    isCropModeActive = true;
    setWidgetVisible(launcher, false, true);
    setWidgetVisible(panel, false, true);
    cropStart = null;
    cropRectangle = null;
    cropSelection.hidden = true;
    cropOverlay.classList.remove("is-selecting");
    cropOverlay.hidden = false;
    cropOverlay.focus();
  }

  function cancelCropMode() {
    cropStart = null;
    cropRectangle = null;
    cropSelection.hidden = true;
    cropOverlay.classList.remove("is-selecting");
    cropOverlay.hidden = true;
    isCropModeActive = false;
    updateSelectionVisibility({ clientX: pointer.x, clientY: pointer.y });
  }

  function getCropRectangle(start, end) {
    const left = Math.max(0, Math.min(start.x, end.x));
    const top = Math.max(0, Math.min(start.y, end.y));
    const right = Math.min(window.innerWidth, Math.max(start.x, end.x));
    const bottom = Math.min(window.innerHeight, Math.max(start.y, end.y));
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function updateCropSelection() {
    if (!cropRectangle) {
      cropSelection.hidden = true;
      return;
    }
    cropSelection.hidden = false;
    cropSelection.style.left = `${cropRectangle.left}px`;
    cropSelection.style.top = `${cropRectangle.top}px`;
    cropSelection.style.width = `${cropRectangle.width}px`;
    cropSelection.style.height = `${cropRectangle.height}px`;
  }

  async function captureAndExplainCrop(rectangle, anchor) {
    const nextRequestId = createRequestId();
    lastRequest = { type: "image", imageDataUrl: "" };
    prepareExplanationRequest(
      nextRequestId,
      "Cropped screen area",
      "Capturing the selected screen area…",
      anchor
    );
    setWidgetVisible(panel, false, true);
    try {
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      });
      if (requestId !== nextRequestId) {
        return;
      }
      const capture = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
      if (requestId !== nextRequestId) {
        return;
      }
      if (!capture?.ok || typeof capture.dataUrl !== "string") {
        throw new Error(capture?.error || "Could not capture the visible tab.");
      }
      const imageDataUrl = await cropScreenshot(capture.dataUrl, rectangle);
      if (requestId !== nextRequestId) {
        return;
      }
      lastRequest = { type: "image", imageDataUrl };
      setWidgetVisible(panel, true);
      setStatus("Sending the cropped image for analysis…");
      sendImageRequest({ imageDataUrl }, nextRequestId);
    } catch (error) {
      setWidgetVisible(panel, true);
      showError(nextRequestId, error instanceof Error ? error.message : "Could not crop the screenshot.");
    }
  }

  function startPanelDrag(event) {
    const bounds = panel.getBoundingClientRect();
    panel.style.position = "fixed";
    panelDrag = {
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top
    };
    panelAttachedToSelection = false;
    panel.classList.add("is-dragging");
    event.preventDefault();
  }

  function movePanelDrag(event) {
    if (!panelDrag) {
      return;
    }

    const bounds = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - bounds.width);
    const maxTop = Math.max(0, window.innerHeight - bounds.height);
    const left = Math.max(0, Math.min(event.clientX - panelDrag.offsetX, maxLeft));
    const top = Math.max(0, Math.min(event.clientY - panelDrag.offsetY, maxTop));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function endPanelDrag() {
    const bounds = panel.getBoundingClientRect();
    panelAnchor = { x: bounds.left, y: bounds.top };
    panelDrag = null;
    panel.classList.remove("is-dragging");
  }

  async function cropScreenshot(dataUrl, rectangle) {
    const image = new Image();
    const loadedImage = new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not read the captured screenshot."));
    });
    image.src = dataUrl;
    await loadedImage;

    const fallbackScale = window.devicePixelRatio || 1;
    const scaleX = image.naturalWidth / window.innerWidth || fallbackScale;
    const scaleY = image.naturalHeight / window.innerHeight || fallbackScale;
    const sourceX = Math.max(0, Math.round(rectangle.left * scaleX));
    const sourceY = Math.max(0, Math.round(rectangle.top * scaleY));
    const sourceWidth = Math.min(image.naturalWidth - sourceX, Math.round(rectangle.width * scaleX));
    const sourceHeight = Math.min(image.naturalHeight - sourceY, Math.round(rectangle.height * scaleY));
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error("The selected crop area is empty.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create an image canvas for cropping.");
    }
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );
    const croppedImage = canvas.toDataURL("image/png");
    if (croppedImage.length > 11_185_000) {
      throw new Error("The cropped image exceeds the 8 MB size limit. Select a smaller area.");
    }
    return croppedImage;
  }

  function sendImageRequest(source, nextRequestId) {
    void chrome.runtime.sendMessage({
      type: "EXPLAIN_IMAGE",
      requestId: nextRequestId,
      ...source
    }).then((result) => {
      if (!result?.ok) {
        showError(nextRequestId, result?.error || "Could not start image analysis.");
      }
    }).catch(() => {
      showError(nextRequestId, "Could not contact the extension service worker. Reload the extension and try again.");
    });
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

  function positionPanel(x, y, attachedRect = null) {
    const bounds = panel.getBoundingClientRect();
    const width = bounds.width || Math.min(390, window.innerWidth - 24);
    const height = bounds.height || Math.min(540, window.innerHeight - 24);
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const maxTop = Math.max(12, window.innerHeight - height - 12);
    const horizontalAnchor = attachedRect ? attachedRect.left : x;
    let verticalAnchor = y;

    if (attachedRect) {
      const below = attachedRect.bottom;
      const above = attachedRect.top - height;
      if (below <= maxTop) {
        verticalAnchor = below;
      } else if (above >= 12) {
        verticalAnchor = above;
      } else {
        verticalAnchor = Math.min(below, maxTop);
      }
    }

    const left = Math.max(12, Math.min(horizontalAnchor, maxLeft));
    const top = Math.max(12, Math.min(verticalAnchor, maxTop));
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
