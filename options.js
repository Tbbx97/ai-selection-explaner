const form = document.querySelector("#settings-form");
const geminiInput = document.querySelector("#gemini-key");
const openaiInput = document.querySelector("#openai-key");
const geminiState = document.querySelector("#gemini-state");
const openaiState = document.querySelector("#openai-state");
const statusMessage = document.querySelector("#status");
const saveButton = form.querySelector(".save-button");
const removeGeminiButton = document.querySelector("#remove-gemini");
const removeOpenaiButton = document.querySelector("#remove-openai");

let savedKeys = { gemini: false, openai: false };

initialize().catch((error) => {
  showStatus(`Không thể tải cấu hình: ${error.message}`, true);
});

removeGeminiButton.addEventListener("click", () => removeKey("gemini"));
removeOpenaiButton.addEventListener("click", () => removeKey("openai"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  showStatus("");

  const geminiKey = geminiInput.value.trim();
  const openaiKey = openaiInput.value.trim();

  try {
    const stored = await chrome.storage.local.get(["geminiApiKey", "openaiApiKey"]);
    const keys = {
      gemini: geminiKey || stored.geminiApiKey || "",
      openai: openaiKey || stored.openaiApiKey || ""
    };
    const provider = keys.gemini ? "gemini" : "openai";

    await chrome.storage.local.set({
      ...(geminiKey ? { geminiApiKey: geminiKey } : {}),
      ...(openaiKey ? { openaiApiKey: openaiKey } : {}),
      provider
    });

    savedKeys = {
      gemini: Boolean(keys.gemini),
      openai: Boolean(keys.openai)
    };
    geminiInput.value = "";
    openaiInput.value = "";
    updateKeyStates();
    showStatus("Đã lưu cấu hình trên máy tính này. Bạn sẵn sàng sử dụng rồi! 🎉");
  } catch (error) {
    showStatus(`Không thể lưu cấu hình: ${error.message}`, true);
  } finally {
    saveButton.disabled = false;
  }
});

geminiInput.addEventListener("input", () => {
  geminiState.textContent = geminiInput.value ? "Key mới đã nhập" : savedKeys.gemini ? "•••••••• Đã lưu" : "";
});

openaiInput.addEventListener("input", () => {
  openaiState.textContent = openaiInput.value ? "Key mới đã nhập" : savedKeys.openai ? "•••••••• Đã lưu" : "";
});

async function initialize() {
  const settings = await chrome.storage.local.get(["geminiApiKey", "openaiApiKey"]);
  savedKeys = {
    gemini: typeof settings.geminiApiKey === "string" && settings.geminiApiKey.length > 0,
    openai: typeof settings.openaiApiKey === "string" && settings.openaiApiKey.length > 0
  };
  updateKeyStates();
}

function updateKeyStates() {
  geminiInput.placeholder = savedKeys.gemini ? "Đã có key — dán key mới để thay thế" : "Dán chìa khóa Gemini vào đây";
  openaiInput.placeholder = savedKeys.openai ? "Đã có key — dán key mới để thay thế" : "Dán chìa khóa OpenAI vào đây";
  geminiState.textContent = savedKeys.gemini ? "•••••••• Đã lưu" : "";
  openaiState.textContent = savedKeys.openai ? "•••••••• Đã lưu" : "";
  removeGeminiButton.hidden = !savedKeys.gemini;
  removeOpenaiButton.hidden = !savedKeys.openai;
}

async function removeKey(provider) {
  const keyName = provider === "gemini" ? "geminiApiKey" : "openaiApiKey";
  try {
    await chrome.storage.local.remove(keyName);
    savedKeys[provider] = false;
    (provider === "gemini" ? geminiInput : openaiInput).value = "";
    const remainingProvider = provider === "gemini" ? "openai" : "gemini";
    if (savedKeys[remainingProvider]) {
      await chrome.storage.local.set({ provider: remainingProvider });
    }
    updateKeyStates();
    showStatus(`Đã xóa key ${provider === "gemini" ? "Gemini" : "OpenAI"} khỏi máy tính này.`);
  } catch (error) {
    showStatus(`Không thể xóa key: ${error.message}`, true);
  }
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.error = String(isError);
  statusMessage.classList.toggle("visible", Boolean(message));
}
