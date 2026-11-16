# AI Selection Explainer

Manifest V3 Chrome extension that explains selected webpage text with Gemini or OpenAI.

## Features

- Select more than five characters on a webpage to open the AI explainer.
- Stream the answer into an isolated Shadow DOM widget with emphasis, ordered/unordered lists, and code-block formatting.
- Generate explanations in the browser/operating-system language, regardless of the webpage's language.
- Highlight quoted foreign-language examples and slash-delimited phonetic text with clearer spacing.
- Classify each answer as learning-related or general; only structured learning examples with a recognizable foreign phrase or pronunciation receive inline read-aloud controls.
- Hover over an image to explain it, or press **Ctrl+Shift+X** to crop any region of the current page; you can also right-click an image and choose **✨ Explain this image with AI**.
- Copy an answer, retry the request, or close the widget from its action bar.
- Store provider API keys locally with `chrome.storage.local`; selected text and user-selected images are sent directly to the chosen AI provider.

Read-aloud uses the browser's built-in speech synthesis and does not send audio. `contextMenus` adds the right-click image action. The crop keyboard shortcut invokes the extension and grants the temporary `activeTab` access required by Chrome's `captureVisibleTab` API; `clipboardWrite` is used only by Copy. `storage` is used for local API-key settings, and host permissions allow the content script and provider/image requests. Images are limited to PNG, JPEG, or WebP and 8 MB.

## Load and test

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this project folder.
3. Open the extension's Options page and save a Gemini or OpenAI API key.
4. Open an HTTP or HTTPS webpage, select a passage longer than five characters, and click the AI button.
5. Confirm the answer streams into the widget, then test **Copy**, **Retry**, and **Close**.
6. Hover over an image and use **✨ Giải thích ảnh**. Press **Ctrl+Shift+X** to start a crop anywhere on the page, then drag and release; on macOS, use **MacCtrl+Shift+X** or check `chrome://extensions/shortcuts` for the assigned shortcut. You can also right-click an image and choose **✨ Explain this image with AI**.
7. For a learning-related selection with a recognizable foreign-language example or pronunciation, confirm the read-aloud controls appear after the answer finishes; for general text, confirm they stay hidden.

After changing extension files, select **Reload** on `chrome://extensions`. Refresh the webpage to reload its content script.
