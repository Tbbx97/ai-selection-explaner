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
  showStatus(`Could not load settings: ${error.message}`, true);
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
    showStatus("Settings saved on this device. You are ready to go! 🎉");
  } catch (error) {
    showStatus(`Could not save settings: ${error.message}`, true);
  } finally {
    saveButton.disabled = false;
  }
});

geminiInput.addEventListener("input", () => {
  geminiState.textContent = geminiInput.value ? "New key entered" : savedKeys.gemini ? "•••••••• Saved" : "";
});

openaiInput.addEventListener("input", () => {
  openaiState.textContent = openaiInput.value ? "New key entered" : savedKeys.openai ? "•••••••• Saved" : "";
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
  geminiInput.placeholder = savedKeys.gemini ? "Key saved — paste a new one to replace it" : "Paste your Gemini API key here";
  openaiInput.placeholder = savedKeys.openai ? "Key saved — paste a new one to replace it" : "Paste your OpenAI API key here";
  geminiState.textContent = savedKeys.gemini ? "•••••••• Saved" : "";
  openaiState.textContent = savedKeys.openai ? "•••••••• Saved" : "";
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
    showStatus(`${provider === "gemini" ? "Gemini" : "OpenAI"} key removed from this device.`);
  } catch (error) {
    showStatus(`Could not remove key: ${error.message}`, true);
  }
}

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.dataset.error = String(isError);
  statusMessage.classList.toggle("visible", Boolean(message));
}
