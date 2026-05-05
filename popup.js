const api = typeof browser !== "undefined" ? browser : chrome;
const usesPromiseApi = typeof browser !== "undefined";
const countElement = document.getElementById("count");
const messageElement = document.getElementById("message");
const toggleButton = document.getElementById("toggle");

let currentState = {
  triggerCount: 0,
  running: false,
  sends: 0,
  message: "Looking for the cat trigger on this tab."
};

async function getActiveTab() {
  const tabs = await callTabs("query", { active: true, currentWindow: true });
  return tabs[0];
}

function callTabs(method, ...args) {
  if (usesPromiseApi) {
    return api.tabs[method](...args);
  }

  return new Promise((resolve, reject) => {
    api.tabs[method](...args, (result) => {
      const error = api.runtime && api.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function sendToActiveTab(type) {
  const tab = await getActiveTab();

  if (!tab || !tab.id) {
    throw new Error("No active tab found.");
  }

  try {
    return await callTabs("sendMessage", tab.id, { type });
  } catch (error) {
    await injectIntoTab(tab.id);
    return callTabs("sendMessage", tab.id, { type });
  }
}

async function injectIntoTab(tabId) {
  await callTabs("executeScript", tabId, {
    allFrames: true,
    file: "src/content.js"
  });
}

async function refreshState() {
  try {
    setState(await sendToActiveTab("cat-autocatcher-get-state"));
  } catch (error) {
    setState({
      triggerCount: 0,
      running: false,
      sends: 0,
      message: "This page cannot be controlled. Reload the page or open a normal website tab."
    });
  }
}

async function toggleAutoCatching() {
  toggleButton.disabled = true;

  try {
    const nextType = currentState.running ? "cat-autocatcher-pause" : "cat-autocatcher-start";
    setState(await sendToActiveTab(nextType));
  } catch (error) {
    setState({
      triggerCount: 0,
      running: false,
      sends: 0,
      message: "Could not start on this page. Reload the page and try again."
    });
  } finally {
    toggleButton.disabled = false;
  }
}

function setState(state) {
  currentState = {
    ...currentState,
    ...state
  };

  countElement.textContent = String(currentState.triggerCount || 0);
  messageElement.textContent = currentState.message || "";
  toggleButton.textContent = currentState.running ? "Pause" : "Start";
  toggleButton.classList.toggle("is-running", Boolean(currentState.running));
}

toggleButton.addEventListener("click", toggleAutoCatching);
refreshState();
