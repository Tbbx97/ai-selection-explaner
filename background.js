const MAX_SELECTION_LENGTH = 20000;
const RESPONSE_TIMEOUT_MS = 30000;
const STREAM_IDLE_TIMEOUT_MS = 20000;
const STREAM_MAX_DURATION_MS = 60000;
const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash"
];
const activeRequests = new Map();

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

  if (message?.type === "CANCEL_EXPLANATION") {
    const request = activeRequests.get(message.requestId);
    if (request?.tabId === tabId) {
      request.controller.abort();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "EXPLAIN_SELECTION") {
    return false;
  }

  const { requestId, text } = message;
  if (
    typeof requestId !== "string" ||
    requestId.length > 100 ||
    typeof text !== "string" ||
    text.trim().length <= 5 ||
    text.length > MAX_SELECTION_LENGTH
  ) {
    sendResponse({ ok: false, error: "The selected text is invalid or too long." });
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
  void streamExplanation(tabId, requestId, text)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "The explanation request failed."
      });
    });
  return true;
});

async function streamExplanation(tabId, requestId, text) {
  const controller = new AbortController();
  activeRequests.set(requestId, { tabId, controller });

  try {
    const settings = await chrome.storage.local.get(["provider", "openaiApiKey", "geminiApiKey"]);
    const preferredProvider = settings.provider === "openai" ? "openai" : "gemini";
    const alternateProvider = preferredProvider === "gemini" ? "openai" : "gemini";
    const provider = settings[`${preferredProvider}ApiKey`]
      ? preferredProvider
      : alternateProvider;
    const apiKey = settings[`${provider}ApiKey`];

    if (typeof apiKey !== "string" || !apiKey.trim()) {
      await sendToTab(tabId, { type: "EXPLANATION_SETUP_REQUIRED", requestId });
      return;
    }

    const response = await withTimeout(
      provider === "gemini"
        ? fetchGeminiWithFallback(apiKey.trim(), text, controller.signal, tabId, requestId)
        : fetchProvider(provider, apiKey.trim(), text, controller.signal),
      RESPONSE_TIMEOUT_MS,
      controller,
      "AI không phản hồi trong 45 giây. Hãy thử lại hoặc kiểm tra kết nối mạng và API key."
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(getApiError(response.status, errorText));
    }
    if (!response.body) {
      throw new Error("The API returned no response stream. Try again.");
    }

    await sendToTab(tabId, {
      type: "EXPLANATION_STATUS",
      requestId,
      status: "Đã kết nối. AI đang chuẩn bị câu trả lời…"
    });

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
        const error = new Error("AI mất quá nhiều thời gian để tạo câu trả lời. Hãy thử lại sau.");
        error.name = "TimeoutError";
        throw error;
      }

      const { value, done } = await withTimeout(
        reader.read(),
        Math.min(STREAM_IDLE_TIMEOUT_MS, remainingTime),
        controller,
        remainingTime <= STREAM_IDLE_TIMEOUT_MS
          ? "AI mất quá nhiều thời gian để tạo câu trả lời. Hãy thử lại sau."
          : "AI đã ngừng phản hồi quá lâu. Hãy thử lại."
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
          requestId
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
            requestId
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
          ? `${providerName} đã kết thúc nhưng không gửi nội dung văn bản (nhận event: ${eventSummary}). Hãy kiểm tra quyền truy cập model và thử lại.`
          : `${providerName} đã đóng luồng nhưng không gửi event hay nội dung. Hãy kiểm tra API key, quyền truy cập model và thử lại.`
      );
    }
    if (!controller.signal.aborted) {
      await sendToTab(tabId, { type: "EXPLANATION_DONE", requestId });
    }
  } catch (error) {
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

async function processStreamEvent(provider, parsedEvent, includeCompletedText, tabId, requestId) {
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
    await sendToTab(tabId, {
      type: "EXPLANATION_STATUS",
      requestId,
      status: result.status
    });
  }
  if (result.text) {
    await sendToTab(tabId, {
      type: "EXPLANATION_CHUNK",
      requestId,
      chunk: result.text
    });
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

async function fetchProvider(provider, apiKey, text, signal) {
  const systemPrompt =
    "Bạn là một trợ lý giải thích ngôn ngữ chuyên nghiệp. Hãy giải thích đoạn văn bản sau một cách ngắn gọn, dễ hiểu nhất, sử dụng từ ngữ bình dân cho người phổ thông:";

  if (provider === "gemini") {
    return fetchGeminiModel(apiKey, text, "gemini-3.8-flash", signal);
  }

  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
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
          content: text
        }
      ]
    }),
    signal
  });
}

async function fetchGeminiWithFallback(apiKey, text, signal, tabId, requestId) {
  for (let index = 0; index < GEMINI_MODELS.length; index += 1) {
    const model = GEMINI_MODELS[index];
    const response = await fetchGeminiModel(apiKey, text, model, signal);

    if (response.status !== 503 || index === GEMINI_MODELS.length - 1) {
      return response;
    }

    await sendToTab(tabId, {
      type: "EXPLANATION_STATUS",
      requestId,
      status: `${model} đang quá tải. Đang thử ${GEMINI_MODELS[index + 1]}…`
    });
  }

  throw new Error("Gemini hiện không khả dụng. Hãy thử lại sau.");
}

async function fetchGeminiModel(apiKey, text, model, signal) {
  const systemPrompt =
    "Bạn là một trợ lý giải thích ngôn ngữ chuyên nghiệp. Hãy giải thích đoạn văn bản sau một cách ngắn gọn, dễ hiểu nhất, sử dụng từ ngữ bình dân cho người phổ thông:";

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
            parts: [{ text }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 512,
          thinkingConfig: {
            thinkingLevel: "MINIMAL"
          }
        }
      }),
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
    const eventLabel = eventName || "không có tên";
    return {
      error: `Không đọc được event stream${provider === "gemini" ? " từ Gemini" : ""} (event: ${eventLabel}; dữ liệu: ${preview}). Hãy tải lại extension và thử lại.`
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: `API trả về event không đúng định dạng (event: ${eventName || "không có tên"}).` };
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
          "Gemini không thể hoàn tất yêu cầu."
      };
    }
    if (payload.promptFeedback?.blockReason) {
      return {
        error: `Gemini đã chặn yêu cầu (${payload.promptFeedback.blockReason}). Hãy thử chọn đoạn văn bản khác.`
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
          error: `Gemini kết thúc mà không trả văn bản (finish reason: ${candidate.finishReason}).`
        };
      }

      return { status: "Gemini đang tạo câu trả lời…" };
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
      return { status: "Đã kết nối với Gemini. Đang tạo câu trả lời…" };
    }
    if (eventType === "step.start" && payload.step?.type === "thought") {
      return { status: "Gemini đang phân tích văn bản…" };
    }
    if (eventType === "step.start" && payload.step?.type === "model_output") {
      return { status: "Gemini đang soạn câu trả lời…" };
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
  } catch {
    // The tab may have navigated or closed while the stream was in progress.
  }
}
