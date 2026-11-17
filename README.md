# AI Selection Explainer

Manifest V3 Chrome extension that explains selected webpage text with Gemini or OpenAI.

## Features

- Select more than five characters on a webpage to open the AI explainer.
- Stream the answer into an isolated Shadow DOM widget with emphasis, ordered/unordered lists, and code-block formatting.
- Generate explanations in the browser/operating-system language, regardless of the webpage's language.
- Highlight quoted foreign-language examples and slash-delimited phonetic text with clearer spacing.
- Classify each answer as learning-related or general; only structured learning examples with a recognizable foreign phrase or pronunciation receive inline read-aloud controls.
- Hover over an image and click **✂️ Crop vùng ảnh này** to start crop mode, or press **Ctrl+Shift+X** to crop any visible region. Right-clicking an image also starts crop mode.
- Copy an answer, retry the request, or close the widget from its action bar.
- Store provider API keys locally with `chrome.storage.local`; selected text and user-selected images are sent directly to the chosen AI provider.

Full-explanation read-aloud uses the user's preferred browser language for the explanation and switches to the detected voice for marked foreign-language vocabulary. Inline example buttons also use the detected language of the foreign phrase. Both use the browser's built-in speech synthesis and do not send audio. `contextMenus` adds a right-click action that starts crop mode. The `<all_urls>` host permission allows `captureVisibleTab` to work when Crop is started from the page's hover button, which does not grant temporary `activeTab` access; capture messages are still accepted only from the active top-level tab. `clipboardWrite` is used only by Copy. `storage.local` holds API keys and is restricted to trusted extension contexts; `scripting` and `activeTab` are not requested. The host permission also supports the content script and provider requests. Vision requests accept PNG, JPEG, or WebP image data up to 8 MB. The extension does not fetch arbitrary image URLs; use the crop shortcut/menu or a local image data URL instead. This avoids browser-side SSRF and DNS-rebinding through remote image URLs. Chrome 102 or later is required to enforce the storage access level.

## Load and test

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this project folder.
3. Open the extension's Options page and save a Gemini or OpenAI API key.
4. Open an HTTP or HTTPS webpage, select a passage longer than five characters, and click the AI button.
5. Confirm the answer streams into the widget, then test **Copy**, **Retry**, and **Close**.
6. Hover over an image and click **✂️ Crop vùng ảnh này**, press **Ctrl+Shift+X**, or right-click an image and choose **✂ Crop this image area with AI** to start crop mode. Drag across the visible area and release; on macOS, use **MacCtrl+Shift+X** or check `chrome://extensions/shortcuts` for the assigned shortcut.
7. For a learning-related selection with a recognizable foreign-language example or pronunciation, confirm the read-aloud controls appear after the answer finishes; for general text, confirm they stay hidden.

After changing extension files, select **Reload** on `chrome://extensions`. Refresh the webpage to reload its content script.
