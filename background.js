const MAX_SELECTION_LENGTH = 20000;
const RESPONSE_TIMEOUT_MS = 30000;
const STREAM_IDLE_TIMEOUT_MS = 20000;
const STREAM_MAX_DURATION_MS = 60000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_CONTEXT_MENU_ID = "ai-selection-explainer-image";
const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash"
];
const activeRequests = new Map();

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) => {
    console.error("Could not restrict local API key storage access:", error);
  });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: IMAGE_CONTEXT_MENU_ID,
      title: "✂ Crop this image area with AI",
      contexts: ["image"]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Could not register the image context menu:", chrome.runtime.lastError.message);
      }
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (
    info.menuItemId !== IMAGE_CONTEXT_MENU_ID ||
    !Number.isInteger(tab?.id)
  ) {
    return;
  }
  void chrome.tabs.sendMessage(tab.id, { action: "startGlobalCrop" })
    .catch((error) => {
      console.warn("Could not start image crop:", error);
    });
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "activate-crop") {
    return;
  }
  void chrome.tabs.query({ active: true, lastFocusedWindow: true })
    .then(([tab]) => {
      if (!Number.isInteger(tab?.id)) {
        throw new Error("No active tab is available for screen cropping.");
      }
      return chrome.tabs.sendMessage(tab.id, { action: "startGlobalCrop" });
    })
    .catch((error) => {
      console.warn("Could not start global crop:", error);
    });
});

class ClientDisconnectedError extends Error {
  constructor() {
    super("The page disconnected while the explanation was streaming.");
    this.name = "ClientDisconnectedError";
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: "This action is only available from a webpage." });
    return false;
  }

  if (message?.type === "GET_PROVIDER_STATUS") {
    chrome.storage.local.get(["geminiApiKey", "openaiApiKey"])
      .then(({ geminiApiKey, openaiApiKey }) => {
        sendResponse({
          ok: true,
          hasKey: Boolean(geminiApiKey || openaiApiKey)
        });
      })
      .catch(() => sendResponse({ ok: false, error: "Could not read the saved settings." }));
    return true;
  }

  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "Could not open the setup guide." }));
    return true;
  }

  if (message?.type === "CAPTURE_VISIBLE_TAB") {
    if (sender.frameId !== 0 || sender.tab.active !== true) {
      sendResponse({
        ok: false,
        error: "Screen capture is only available from the active top-level tab."
      });
      return false;
    }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({
        ok: false,
        error: `Could not capture the visible tab: ${error.message}`
      }));
    return true;
  }

  if (message?.type === "CANCEL_EXPLANATION") {
    const request = activeRequests.get(message.requestId);
    if (request?.tabId === tabId) {
      request.controller.abort();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "EXPLAIN_SELECTION" && message?.type !== "EXPLAIN_IMAGE") {
    return false;
  }

  const { requestId } = message;
  if (!isValidRequestId(requestId)) {
    sendResponse({ ok: false, error: "The selected text is invalid or too long." });
    return false;
  }
  if (message.type === "EXPLAIN_IMAGE" && message.imageUrl !== undefined) {
    sendResponse({
      ok: false,
      error: "Remote image URLs are not fetched for security. Use the crop shortcut or an image data URL."
    });
    return false;
  }
  const request = message.type === "EXPLAIN_SELECTION"
    ? { text: message.text }
    : {
      imageDataUrl: message.imageDataUrl
    };
  if (!isValidExplanationRequest(message.type, request)) {
    sendResponse({ ok: false, error: "The explanation request is invalid or too large." });
    return false;
  }

  if (activeRequests.has(requestId)) {
    const activeRequest = activeRequests.get(requestId);
    if (activeRequest.tabId === tabId) {
      sendResponse({ ok: true, duplicate: true });
    } else {
      sendResponse({ ok: false, error: "This request ID is already in use." });
    }
    return false;
  }

  // Keep the extension message channel alive for the lifetime of the stream.
  // Otherwise Chrome may suspend this service worker after this listener
  // returns, leaving the content script stuck on its last status message.
  void streamExplanation(tabId, requestId, request)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "The explanation request failed."
      });
    });
  return true;
});

function isValidRequestId(requestId) {
  return typeof requestId === "string" && requestId.length > 0 && requestId.length <= 100;
}

function isValidExplanationRequest(type, request) {
  if (type === "EXPLAIN_SELECTION") {
    return typeof request.text === "string" &&
      request.text.trim().length > 5 &&
      request.text.length <= MAX_SELECTION_LENGTH;
  }
  return type === "EXPLAIN_IMAGE" &&
    typeof request.imageDataUrl === "string" &&
    request.imageDataUrl.length <= Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128;
}

function parseImageDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) {
    throw new Error("The image must be a valid PNG, JPEG, or WebP data URL.");
  }
  const base64 = match[2];
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3)) {
    throw new Error("The image exceeds the 8 MB size limit.");
  }
  const data = atob(base64);
  if (data.length > MAX_IMAGE_BYTES) {
    throw new Error("The image exceeds the 8 MB size limit.");
  }
  return { mimeType: match[1].toLowerCase(), data: base64 };
}

async function streamExplanation(tabId, requestId, request) {
  const controller = new AbortController();
  activeRequests.set(requestId, { tabId, controller });

  try {
    const osLanguage = getLanguageName(navigator.language);
    const systemPrompt = createSystemPrompt(osLanguage);
    const settings = await chrome.storage.local.get(["provider", "openaiApiKey", "geminiApiKey"]);
    const preferredProvider = settings.provider === "openai" ? "openai" : "gemini";
    const alternateProvider = preferredProvider === "gemini" ? "openai" : "gemini";
    const provider = settings[`${preferredProvider}ApiKey`]
      ? preferredProvider
      : alternateProvider;
    const apiKey = settings[`${provider}ApiKey`];

    if (typeof apiKey !== "string" || !apiKey.trim()) {
      await sendToTabOrAbort(
        tabId,
        { type: "EXPLANATION_SETUP_REQUIRED", requestId },
        controller
      );
      return;
    }

    const image = request.imageDataUrl ? parseImageDataUrl(request.imageDataUrl) : null;
    const userText = request.text || "Please explain the important content in this image.";
    const response = await withTimeout(
      provider === "gemini"
        ? fetchGeminiWithFallback(apiKey.trim(), userText, controller, tabId, requestId, systemPrompt, image)
        : fetchProvider(provider, apiKey.trim(), userText, controller.signal, systemPrompt, image),
      RESPONSE_TIMEOUT_MS,
      controller,
      "The AI provider did not respond within 30 seconds. Try again or check your network connection and API key."
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(getApiError(response.status, errorText));
    }
    if (!response.body) {
      throw new Error("The API returned no response stream. Try again.");
    }

    await sendToTabOrAbort(tabId, {
      type: "EXPLANATION_STATUS",
      requestId,
      status: image ? "Image received. The AI is analyzing it…" : "Connected. The AI is preparing a response…"
    }, controller);

    // Read each network chunk as it arrives, decode UTF-8 safely, and split the
    // SSE events independently of network chunk boundaries before forwarding text.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedText = false;
    let finished = false;
    const receivedEventNames = new Set();
    const streamStartedAt = Date.now();

    while (!finished) {
      const remainingTime = STREAM_MAX_DURATION_MS - (Date.now() - streamStartedAt);
      if (remainingTime <= 0) {
        controller.abort();
        const error = new Error("The AI is taking too long to respond. Please try again later.");
        error.name = "TimeoutError";
        throw error;
      }

      const { value, done } = await withTimeout(
        reader.read(),
        Math.min(STREAM_IDLE_TIMEOUT_MS, remainingTime),
        controller,
        remainingTime <= STREAM_IDLE_TIMEOUT_MS
          ? "The AI is taking too long to respond. Please try again later."
          : "The AI stopped responding. Please try again."
      );
      buffer += decoder.decode(value, { stream: !done });

      let boundary = /(?:\r\n|\r|\n)(?:\r\n|\r|\n)/.exec(buffer);
      while (boundary) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const parsedEvent = parseSSEEvent(event);
        if (parsedEvent.name) {
          receivedEventNames.add(parsedEvent.name);
        }
        const result = await processStreamEvent(
          provider,
          parsedEvent,
          !receivedText,
          tabId,
          requestId,
          controller
        );
        if (result.text) {
          receivedText = true;
        }
        if (result.done) {
          finished = true;
          break;
        }
        boundary = /(?:\r\n|\r|\n)(?:\r\n|\r|\n)/.exec(buffer);
      }

      if (done) {
        if (buffer) {
          const parsedEvent = parseSSEEvent(buffer);
          if (parsedEvent.name) {
            receivedEventNames.add(parsedEvent.name);
          }
          const result = await processStreamEvent(
            provider,
            parsedEvent,
            !receivedText,
            tabId,
            requestId,
            controller
          );
          if (result.text) {
            receivedText = true;
          }
          finished = result.done || finished;
        }
        break;
      }
    }

    if (!receivedText && !controller.signal.aborted) {
      const eventSummary = [...receivedEventNames].slice(0, 6).join(", ");
      const providerName = provider === "gemini" ? "Gemini" : "OpenAI";
      throw new Error(
        eventSummary
          ? `${providerName} finished without sending any text (received events: ${eventSummary}). Check model access and try again.`
          : `${providerName} closed the stream without sending any events or content. Check your API key and model access, then try again.`
      );
    }
    if (!controller.signal.aborted) {
      await sendToTabOrAbort(tabId, { type: "EXPLANATION_DONE", requestId }, controller);
    }
  } catch (error) {
    if (error instanceof ClientDisconnectedError) {
      return;
    }
    if (!controller.signal.aborted || error?.name === "TimeoutError") {
      const message = error instanceof Error ? error.message : "The explanation request failed.";
      await sendToTab(tabId, { type: "EXPLANATION_ERROR", requestId, error: message });
    }
  } finally {
    if (activeRequests.get(requestId)?.controller === controller) {
      activeRequests.delete(requestId);
    }
  }
}

async function processStreamEvent(provider, parsedEvent, includeCompletedText, tabId, requestId, controller) {
  const result = extractText(
    provider,
    parsedEvent.data,
    parsedEvent.name,
    includeCompletedText
  );

  if (result.error) {
    throw new Error(result.error);
  }
  if (result.status) {
    await sendToTabOrAbort(tabId, {
      type: "EXPLANATION_STATUS",
      requestId,
      status: result.status
    }, controller);
  }
  if (result.text) {
    await sendToTabOrAbort(tabId, {
      type: "EXPLANATION_CHUNK",
      requestId,
      chunk: result.text
    }, controller);
  }

  return result;
}

async function withTimeout(promise, timeoutMs, controller, errorMessage) {
  let timeoutId;
  let timeoutError;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timeoutError = new Error(errorMessage);
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    if (timeoutError) {
      controller.abort(timeoutError);
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getLanguageName(langCode) {
  try {
    const languageCode = new Intl.Locale(langCode).language;
    return new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode) || languageCode;
  } catch {
    return "English";
  }
}

function createSystemPrompt(osLanguage) {
  return [
    `You are a professional language and vision AI assistant. Your task is to explain, translate, or break down the text/image context provided. CRITICAL RULE: You MUST write the entire explanation, definitions of vocabularies, and response in ${osLanguage} language so the user can understand it natively and easily.`,
    "On the very first line, output exactly [CONTEXT:LEARNING] only when the selected text or image content is explicitly educational material, such as a vocabulary item, foreign-language phrase, pronunciation guide, or language lesson. Do not classify ordinary content as learning material just because it contains a quotation or foreign word. Otherwise, output exactly [CONTEXT:GENERAL]. Start the explanation on the next line.",
    "For learning-related explanations, format each speakable foreign-language phrase or vocabulary item before its translation, optionally followed by its pronunciation, for example: **hello** /həˈloʊ/ — a greeting. Keep the translation after the em dash so the extension can place a read-aloud control beside the phrase."
  ].join("\n\n");
}

async function fetchProvider(provider, apiKey, text, signal, systemPrompt, image) {
  if (provider === "gemini") {
    return fetchGeminiModel(apiKey, text, "gemini-3.8-flash", signal, systemPrompt, image);
  }

  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: image
            ? [
              { type: "text", text },
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.mimeType};base64,${image.data}`
                }
              }
            ]
            : text
        }
      ]
    }),
    signal
  });
}

async function fetchGeminiWithFallback(apiKey, text, controller, tabId, requestId, systemPrompt, image) {
  for (let index = 0; index < GEMINI_MODELS.length; index += 1) {
    const model = GEMINI_MODELS[index];
    const response = await fetchGeminiModel(apiKey, text, model, controller.signal, systemPrompt, image);

    if (response.status !== 503 || index === GEMINI_MODELS.length - 1) {
      return response;
    }

    await sendToTabOrAbort(tabId, {
      type: "EXPLANATION_STATUS",
      requestId,
      status: `${model} is busy. Trying ${GEMINI_MODELS[index + 1]}…`
    }, controller);
  }

  throw new Error("Gemini is currently unavailable. Please try again later.");
}

async function fetchGeminiModel(apiKey, text, model, signal, systemPrompt, image) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [
              { text },
              ...(image ? [{
                inline_data: {
                  mime_type: image.mimeType,
                  data: image.data
                }
              }] : [])
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 512,
          thinkingConfig: {
            thinkingLevel: "MINIMAL"
          }
        }
      }),
      redirect: "error",
      signal
    }
  );
}

function parseSSEEvent(event) {
  let name = "";
  const dataLines = [];

  for (const line of event.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

    if (field === "event") {
      name = value.trim();
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  return { name, data: dataLines.join("\n").trim().replace(/^\uFEFF/, "") };
}

function extractText(provider, data, eventName = "", includeCompletedText = false) {
  const normalizedData = typeof data === "string" ? data.trim().replace(/^\uFEFF/, "") : "";
  if (normalizedData === "[DONE]") {
    return { done: true };
  }
  if (!normalizedData) {
    return { text: "" };
  }

  let payload;
  try {
    payload = JSON.parse(normalizedData);
  } catch {
    const preview = normalizedData.slice(0, 100).replace(/\s+/g, " ");
    const eventLabel = eventName || "unnamed";
    return {
      error: `Could not read the event stream${provider === "gemini" ? " from Gemini" : ""} (event: ${eventLabel}; data: ${preview}). Reload the extension and try again.`
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: `The API returned an invalid event (event: ${eventName || "unnamed"}).` };
  }

  const eventType = payload.event_type || eventName;
  if (payload.error?.message) {
    return { error: payload.error.message };
  }

  if (provider === "gemini") {
    if (eventType === "interaction.failed" || eventType === "error") {
      return {
        error:
          payload.interaction?.error?.message ||
          payload.interaction?.status_message ||
          payload.error?.message ||
          "Gemini could not complete the request."
      };
    }
    if (payload.promptFeedback?.blockReason) {
      return {
        error: `Gemini blocked the request (${payload.promptFeedback.blockReason}). Try selecting different text.`
      };
    }

    const candidate = payload.candidates?.[0];
    if (candidate) {
      const text = (candidate.content?.parts || [])
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");

      if (text) {
        return {
          text,
          done: Boolean(candidate.finishReason)
        };
      }

      if (candidate.finishReason) {
        if (candidate.finishReason === "STOP") {
          return { text: "", done: true };
        }
        return {
          error: `Gemini finished without returning text (finish reason: ${candidate.finishReason}).`
        };
      }

      return { status: "Gemini is generating a response…" };
    }

    if (eventType === "interaction.completed") {
      const finalText = includeCompletedText
        ? (payload.interaction?.steps || [])
          .filter((step) => step.type === "model_output")
          .flatMap((step) => step.content || [])
          .filter((content) => content.type === "text")
          .map((content) => content.text || "")
          .join("")
        : "";
      return { done: true, text: finalText };
    }
    if (eventType === "interaction.created") {
      return { status: "Connected to Gemini. Generating a response…" };
    }
    if (eventType === "step.start" && payload.step?.type === "thought") {
      return { status: "Gemini is analyzing the text…" };
    }
    if (eventType === "step.start" && payload.step?.type === "model_output") {
      return { status: "Gemini is drafting a response…" };
    }
    if (eventType !== "step.delta" || payload.delta?.type !== "text") {
      return { text: "" };
    }
    return {
      text: typeof payload.delta.text === "string" ? payload.delta.text : ""
    };
  }

  return { text: payload.choices?.[0]?.delta?.content || "" };
}

function getApiError(status, body) {
  try {
    const payload = JSON.parse(body);
    const detail = payload.error?.message || payload.message;
    if (typeof detail === "string" && detail.length > 0) {
      return `API error (${status}): ${detail.slice(0, 500)}`;
    }
  } catch {
    // Use the status code below when the provider did not return JSON.
  }
  return `API request failed (${status}). Check your API key, quota, and provider settings.`;
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

async function sendToTabOrAbort(tabId, message, controller) {
  if (await sendToTab(tabId, message)) {
    return;
  }

  controller.abort();
  console.debug("Content script disconnected; aborting the active explanation stream.");
  throw new ClientDisconnectedError();
}
