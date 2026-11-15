# AI Selection Explainer

Manifest V3 Chrome extension that explains selected webpage text with Gemini or OpenAI.

## Features

- Select more than five characters on a webpage to open the AI explainer.
- Stream the answer into an isolated Shadow DOM widget with emphasis, ordered/unordered lists, and code-block formatting.
- Highlight quoted foreign-language examples and slash-delimited phonetic text with clearer spacing.
- Classify each answer as learning-related or general; learning answers offer browser-based read-aloud controls for the explanation and highlighted examples.
- Copy an answer, retry the request, or close the widget from its action bar.
- Store provider API keys locally with `chrome.storage.local`; requests go directly to the chosen AI provider.

Read-aloud uses the browser's built-in speech synthesis and does not send audio or require another extension permission. The `clipboardWrite` permission is used only by the Copy action. `storage` is used for local API-key settings, and the host permissions allow the content script and direct provider requests.

## Load and test

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this project folder.
3. Open the extension's Options page and save a Gemini or OpenAI API key.
4. Open an HTTP or HTTPS webpage, select a passage longer than five characters, and click the AI button.
5. Confirm the answer streams into the widget, then test **Copy**, **Thử lại**, and **Đóng**.
6. For a learning-related selection, confirm **🔊 Đọc lên** appears after the answer finishes and the inline speaker buttons read highlighted examples; for general text, confirm all read-aloud controls stay hidden.

After changing extension files, select **Reload** on `chrome://extensions`. Refresh the webpage to reload its content script.
