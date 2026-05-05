(() => {
  if (window.__catAutoCatcherLoaded) {
    window.dispatchEvent(new CustomEvent("cat-autocatcher-rescan"));
    return;
  }

  window.__catAutoCatcherLoaded = true;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const TRIGGER_ATTRIBUTE = "data-cat-autocatcher-trigger";
  const CONTROL_ATTRIBUTE = "data-cat-autocatcher-control";
  const TRIGGER_TEXT = 'cat has appeared! type "cat" to catch it!';
  const TRIGGER_TEXT_REGEX = /cat\s+has\s+appeared!?\s+type\s+["'“”]?cat["'“”]?\s+to\s+catch\s+it!?/i;
  const TRIGGER_SELECTOR = [
    "span",
    "div",
    "p",
    "li",
    "[role='article']",
    "[class*='message']",
    "[class*='markup']"
  ].join(",");
  const TEXTBOX_SELECTOR = [
    "div[role='textbox'][contenteditable='true']",
    "div[data-slate-editor='true']",
    "div[contenteditable='true']",
    "textarea",
    "input[type='text']"
  ].join(",");
  const SEND_BUTTON_SELECTOR = [
    "button[aria-label='Send']",
    "button[aria-label='Send Message']",
    "button[aria-label='Send message']",
    "button[type='submit']"
  ].join(",");

  const DEFAULT_SCAN_INTERVAL_MS = 1000;
  const DEFAULT_COOLDOWN_MS = 3000;
  const MIN_SCAN_INTERVAL_MS = 250;
  const MAX_SCAN_INTERVAL_MS = 60000;
  const SETTINGS_KEY = "cat-autocatcher-settings-v1";
  const savedSettings = readSettings();

  let scanTimer = 0;
  let intervalTimer = 0;
  let isAutoCatching = false;
  let scanIntervalMs = clampInterval(savedSettings.intervalMs);
  let sendCount = 0;
  let triggerCount = 0;
  let lastSendAt = 0;
  let lastHandledTriggerKey = "";
  let triggerOrderCounter = 0;
  let lastMessage = "Paused.";
  let controlRoot = null;
  let controlHeader = null;
  let controlButton = null;
  let controlStatus = null;
  let controlCount = null;
  let controlIntervalInput = null;
  let controlIntervalLabel = null;
  let controlMinimizeButton = null;
  let controlCloseButton = null;
  let controlResizeHandle = null;
  let controlPosition = savedSettings.position || null;
  let controlSize = savedSettings.size || { width: 270, height: 0 };
  let controlClosed = Boolean(savedSettings.closed);
  let controlMinimized = Boolean(savedSettings.minimized);
  let compactClickTimer = 0;
  const triggerSeenOrder = new WeakMap();

  function readSettings() {
    try {
      return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          intervalMs: scanIntervalMs,
          position: controlPosition,
          size: controlSize,
          closed: controlClosed,
          minimized: controlMinimized
        })
      );
    } catch (error) {
      // Some pages block localStorage for extension scripts.
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampInterval(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return DEFAULT_SCAN_INTERVAL_MS;
    }

    return clamp(numberValue, MIN_SCAN_INTERVAL_MS, MAX_SCAN_INTERVAL_MS);
  }

  function formatSeconds(intervalMs) {
    return String(Math.round((intervalMs / 1000) * 100) / 100);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isExtensionControlElement(element) {
    return Boolean(controlRoot && (element === controlRoot || controlRoot.contains(element)));
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || isExtensionControlElement(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isOnScreen(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function clearMarks() {
    document.querySelectorAll(`[${TRIGGER_ATTRIBUTE}]`).forEach((element) => {
      element.removeAttribute(TRIGGER_ATTRIBUTE);
      element.style.removeProperty("outline");
      element.style.removeProperty("outline-offset");
      element.style.removeProperty("box-shadow");
    });
  }

  function matchesTrigger(element) {
    return TRIGGER_TEXT_REGEX.test(normalizeText(element.textContent));
  }

  function findTriggerElements() {
    clearMarks();

    const rawMatches = Array.from(document.querySelectorAll(TRIGGER_SELECTOR))
      .filter(isVisible)
      .filter(matchesTrigger);

    const matches = rawMatches.filter((element) => {
      return !rawMatches.some((other) => other !== element && element.contains(other));
    });

    matches.forEach((element) => {
      if (!triggerSeenOrder.has(element)) {
        triggerOrderCounter += 1;
        triggerSeenOrder.set(element, triggerOrderCounter);
      }

      element.setAttribute(TRIGGER_ATTRIBUTE, "");
      element.style.setProperty("outline", "3px solid #22c55e", "important");
      element.style.setProperty("outline-offset", "3px", "important");
      element.style.setProperty("box-shadow", "0 0 0 6px rgba(34, 197, 94, 0.22)", "important");
    });

    triggerCount = matches.filter(isOnScreen).length;
    reportCount(triggerCount);
    renderControl();
    return matches;
  }

  function getNewestTrigger(matches) {
    return matches
      .filter(isOnScreen)
      .reduce((newest, element) => {
        if (!newest) {
          return element;
        }

        const newestOrder = triggerSeenOrder.get(newest) || 0;
        const elementOrder = triggerSeenOrder.get(element) || 0;
        if (elementOrder !== newestOrder) {
          return elementOrder > newestOrder ? element : newest;
        }

        return element.getBoundingClientRect().bottom >= newest.getBoundingClientRect().bottom ? element : newest;
      }, null);
  }

  function getTriggerKey(element) {
    if (!element) {
      return "";
    }

    const order = triggerSeenOrder.get(element) || 0;
    return `${order}:${normalizeText(element.textContent).slice(0, 160)}`;
  }

  function getVisibleTrigger() {
    const matches = findTriggerElements();
    const newestTrigger = getNewestTrigger(matches);
    if (newestTrigger) {
      return {
        visible: true,
        key: getTriggerKey(newestTrigger)
      };
    }

    const bodyText = normalizeText(document.body ? document.body.textContent : "");
    return {
      visible: TRIGGER_TEXT_REGEX.test(bodyText),
      key: "body"
    };
  }

  function findTextboxes() {
    return Array.from(document.querySelectorAll(TEXTBOX_SELECTOR))
      .filter(isVisible)
      .filter((element) => {
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
          return !element.disabled && !element.readOnly;
        }

        return element.isContentEditable || element.getAttribute("role") === "textbox";
      });
  }

  function findTextbox() {
    const boxes = findTextboxes().filter(isOnScreen);
    const candidates = boxes.length ? boxes : findTextboxes();
    const sorted = candidates.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.bottom - aRect.bottom;
    });

    return sorted[0] || null;
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInput(element, data) {
    try {
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data
        })
      );
    } catch (error) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function insertCatText(textbox) {
    textbox.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    textbox.focus();
    textbox.click();

    if (textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) {
      setNativeValue(textbox, `${textbox.value || ""}cat`);
      dispatchInput(textbox, "cat");
      return;
    }

    const beforeText = normalizeText(textbox.textContent);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, "cat");
    } catch (error) {
      inserted = false;
    }

    const afterText = normalizeText(textbox.textContent);
    if (!inserted && afterText === beforeText) {
      textbox.textContent = `${textbox.textContent || ""}cat`;
    }

    dispatchInput(textbox, "cat");
  }

  function dispatchEnter(element) {
    ["keydown", "keypress", "keyup"].forEach((type) => {
      const event = new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      element.dispatchEvent(event);
    });
  }

  function findSendButton() {
    const buttons = Array.from(document.querySelectorAll(SEND_BUTTON_SELECTOR))
      .filter(isVisible)
      .filter(isOnScreen);

    return buttons.find((button) => {
      const label = normalizeText(button.getAttribute("aria-label") || button.textContent);
      return /^(send|send message)$/i.test(label) || button.type === "submit";
    }) || null;
  }

  function clickSendButtonSoon() {
    window.setTimeout(() => {
      const sendButton = findSendButton();
      if (sendButton) {
        sendButton.click();
      }
    }, 120);
  }

  function sendCat() {
    const textbox = findTextbox();
    if (!textbox) {
      throw new Error("Message box not found.");
    }

    insertCatText(textbox);
    dispatchEnter(textbox);
    clickSendButtonSoon();
  }

  function reportState() {
    renderControl();

    try {
      api.runtime.sendMessage({
        type: "cat-autocatcher-state",
        triggerCount,
        running: isAutoCatching,
        sends: sendCount,
        message: lastMessage,
        title: document.title,
        url: window.location.href
      });
    } catch (error) {
      // The extension context can disappear during hot reloads or navigation.
    }
  }

  function reportCount(count) {
    try {
      api.runtime.sendMessage({
        type: "cat-autocatcher-count",
        triggerCount: count,
        running: isAutoCatching,
        title: document.title,
        url: window.location.href
      });
    } catch (error) {
      // The extension context can disappear during hot reloads or navigation.
    }
  }

  function getState() {
    findTriggerElements();
    return {
      triggerCount,
      running: isAutoCatching,
      sends: sendCount,
      lastSendAt: lastSendAt ? new Date(lastSendAt).toISOString() : null,
      message: lastMessage,
      intervalMs: scanIntervalMs,
      url: window.location.href
    };
  }

  function scanAndCatch() {
    if (!isAutoCatching) {
      return getState();
    }

    const trigger = getVisibleTrigger();

    if (!trigger.visible) {
      lastHandledTriggerKey = "";
      lastMessage = "Running. Waiting for cat trigger.";
      reportState();
      return getState();
    }

    if (trigger.key && trigger.key === lastHandledTriggerKey) {
      lastMessage = "Running. Already handled the newest visible trigger.";
      reportState();
      return getState();
    }

    const now = Date.now();
    if (now - lastSendAt < DEFAULT_COOLDOWN_MS) {
      lastMessage = "Running. Trigger visible; waiting for cooldown.";
      reportState();
      return getState();
    }

    try {
      sendCat();
      lastSendAt = now;
      lastHandledTriggerKey = trigger.key;
      sendCount += 1;
      lastMessage = `Running. Sent cat ${sendCount} time${sendCount === 1 ? "" : "s"}.`;
    } catch (error) {
      lastMessage = `Trigger visible, but send failed: ${error.message}`;
    }

    reportState();
    return getState();
  }

  function startAutoCatching() {
    if (isAutoCatching) {
      return getState();
    }

    if (controlClosed) {
      controlClosed = false;
      saveSettings();
    }

    isAutoCatching = true;
    lastMessage = `Running. Checking every ${formatSeconds(scanIntervalMs)} seconds.`;
    window.clearInterval(intervalTimer);
    scanAndCatch();
    intervalTimer = window.setInterval(scanAndCatch, scanIntervalMs);
    reportState();
    return getState();
  }

  function pauseAutoCatching() {
    if (controlClosed) {
      controlClosed = false;
      saveSettings();
    }

    isAutoCatching = false;
    try {
      window.clearInterval(intervalTimer);
    } catch (error) {
      // The document can be tearing down during navigation.
    }
    intervalTimer = 0;
    lastMessage = "Paused.";
    reportState();
    return getState();
  }

  function setScanIntervalMs(nextIntervalMs) {
    const next = clampInterval(nextIntervalMs);
    scanIntervalMs = next;
    saveSettings();

    if (isAutoCatching) {
      window.clearInterval(intervalTimer);
      intervalTimer = window.setInterval(scanAndCatch, scanIntervalMs);
      lastMessage = `Running. Checking every ${formatSeconds(scanIntervalMs)} seconds.`;
      reportState();
    } else {
      renderControl();
    }
  }

  function closeControl() {
    controlClosed = true;
    saveSettings();
    renderControl();
  }

  function minimizeControl() {
    controlClosed = false;
    controlMinimized = true;
    saveSettings();
    renderControl();
  }

  function restoreControl() {
    controlClosed = false;
    controlMinimized = false;
    saveSettings();
    renderControl();
  }

  function toggleAutoCatchingFromControl() {
    if (isAutoCatching) {
      pauseAutoCatching();
    } else {
      startAutoCatching();
    }
  }

  function handleControlButtonClick(event) {
    if (!controlMinimized) {
      toggleAutoCatchingFromControl();
      return;
    }

    window.clearTimeout(compactClickTimer);

    if (event.detail >= 2) {
      compactClickTimer = 0;
      restoreControl();
      return;
    }

    compactClickTimer = window.setTimeout(() => {
      compactClickTimer = 0;
      toggleAutoCatchingFromControl();
    }, 220);
  }

  function getControlWidth() {
    const maxWidth = Math.max(230, window.innerWidth - 24);
    return clamp(Number(controlSize.width) || 270, 230, maxWidth);
  }

  function getControlHeight() {
    if (!controlSize.height) {
      return 0;
    }

    const maxHeight = Math.max(150, window.innerHeight - 24);
    return clamp(Number(controlSize.height) || 0, 150, maxHeight);
  }

  function applyControlGeometry() {
    if (!controlRoot) {
      return;
    }

    if (controlMinimized) {
      controlRoot.style.setProperty("min-width", "0", "important");
      controlRoot.style.setProperty("min-height", "0", "important");
      controlRoot.style.setProperty("width", "84px", "important");
      controlRoot.style.removeProperty("height");
    } else {
      const width = getControlWidth();
      const height = getControlHeight();
      controlRoot.style.setProperty("min-width", "230px", "important");
      controlRoot.style.setProperty("min-height", "150px", "important");
      controlRoot.style.setProperty("width", `${width}px`, "important");

      if (height > 0) {
        controlRoot.style.setProperty("height", `${height}px`, "important");
      } else {
        controlRoot.style.removeProperty("height");
      }
    }

    if (controlPosition) {
      const rect = controlRoot.getBoundingClientRect();
      const nextX = clamp(Number(controlPosition.x) || 0, 0, Math.max(0, window.innerWidth - rect.width));
      const nextY = clamp(Number(controlPosition.y) || 0, 0, Math.max(0, window.innerHeight - rect.height));
      controlPosition = { x: nextX, y: nextY };
      controlRoot.style.setProperty("left", `${nextX}px`, "important");
      controlRoot.style.setProperty("top", `${nextY}px`, "important");
      controlRoot.style.setProperty("right", "auto", "important");
      controlRoot.style.setProperty("bottom", "auto", "important");
    } else {
      controlRoot.style.setProperty("right", "16px", "important");
      controlRoot.style.setProperty("bottom", "16px", "important");
      controlRoot.style.setProperty("left", "auto", "important");
      controlRoot.style.setProperty("top", "auto", "important");
    }
  }

  function startControlDrag(event) {
    if (!controlRoot || event.button !== 0) {
      return;
    }

    event.preventDefault();
    const rect = controlRoot.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    function onPointerMove(moveEvent) {
      controlPosition = {
        x: moveEvent.clientX - offsetX,
        y: moveEvent.clientY - offsetY
      };
      applyControlGeometry();
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      saveSettings();
    }

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
  }

  function startControlResize(event) {
    if (!controlRoot || controlMinimized || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = controlRoot.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    controlPosition = { x: rect.left, y: rect.top };
    applyControlGeometry();

    function onPointerMove(moveEvent) {
      controlSize = {
        width: clamp(startWidth + moveEvent.clientX - startX, 230, Math.max(230, window.innerWidth - controlPosition.x)),
        height: clamp(startHeight + moveEvent.clientY - startY, 150, Math.max(150, window.innerHeight - controlPosition.y))
      };
      applyControlGeometry();
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      saveSettings();
    }

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
  }

  function createControl() {
    if (controlRoot || !document.body) {
      return;
    }

    controlRoot = document.createElement("div");
    controlRoot.setAttribute(CONTROL_ATTRIBUTE, "");
    controlRoot.className = "cat-autocatcher-control";
    controlRoot.style.cssText = [
      "position: fixed !important",
      "right: 16px !important",
      "bottom: 16px !important",
      "z-index: 2147483647 !important",
      "display: grid !important",
      "grid-template-columns: 1fr !important",
      "gap: 8px !important",
      "min-width: 230px !important",
      "min-height: 150px !important",
      "max-width: calc(100vw - 24px) !important",
      "max-height: calc(100vh - 24px) !important",
      "box-sizing: border-box !important",
      "border: 1px solid rgba(15, 23, 42, 0.16) !important",
      "border-radius: 8px !important",
      "background: #ffffff !important",
      "color: #0f172a !important",
      "box-shadow: 0 18px 46px rgba(15, 23, 42, 0.22) !important",
      "font: 13px/1.25 Arial, Helvetica, sans-serif !important",
      "overflow: hidden !important",
      "padding: 10px !important"
    ].join("; ");

    controlHeader = document.createElement("div");
    controlHeader.style.cssText = [
      "align-items: center !important",
      "cursor: move !important",
      "display: grid !important",
      "grid-template-columns: 1fr auto !important",
      "gap: 10px !important",
      "user-select: none !important"
    ].join("; ");
    controlHeader.title = "Drag to move";
    controlHeader.addEventListener("pointerdown", startControlDrag);

    const title = document.createElement("strong");
    title.textContent = "Cat Catcher";
    title.style.cssText = [
      "color: #0f172a !important",
      "font: 800 14px/1.2 Arial, Helvetica, sans-serif !important"
    ].join("; ");

    const headerActions = document.createElement("div");
    headerActions.style.cssText = [
      "align-items: center !important",
      "display: grid !important",
      "grid-template-columns: auto auto auto !important",
      "gap: 6px !important",
      "justify-items: end !important"
    ].join("; ");

    controlCount = document.createElement("span");
    controlCount.className = "cat-autocatcher-control-count";
    controlCount.style.cssText = [
      "justify-self: end !important",
      "color: #2563eb !important",
      "font: 800 12px/1.2 Arial, Helvetica, sans-serif !important"
    ].join("; ");

    function styleHeaderButton(button) {
      button.style.cssText = [
        "align-items: center !important",
        "appearance: none !important",
        "background: #f8fafc !important",
        "border: 1px solid #cbd5e1 !important",
        "border-radius: 6px !important",
        "box-sizing: border-box !important",
        "color: #0f172a !important",
        "cursor: pointer !important",
        "display: inline-flex !important",
        "font: 900 13px/1 Arial, Helvetica, sans-serif !important",
        "height: 22px !important",
        "justify-content: center !important",
        "padding: 0 !important",
        "width: 22px !important"
      ].join("; ");
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
    }

    controlMinimizeButton = document.createElement("button");
    controlMinimizeButton.type = "button";
    controlMinimizeButton.textContent = "-";
    controlMinimizeButton.title = "Minimize to pause button";
    controlMinimizeButton.setAttribute("aria-label", "Minimize panel");
    styleHeaderButton(controlMinimizeButton);
    controlMinimizeButton.addEventListener("click", minimizeControl);

    controlCloseButton = document.createElement("button");
    controlCloseButton.type = "button";
    controlCloseButton.textContent = "x";
    controlCloseButton.title = "Close panel";
    controlCloseButton.setAttribute("aria-label", "Close panel");
    styleHeaderButton(controlCloseButton);
    controlCloseButton.addEventListener("click", closeControl);

    controlIntervalLabel = document.createElement("label");
    controlIntervalLabel.style.cssText = [
      "align-items: center !important",
      "color: #334155 !important",
      "display: grid !important",
      "font: 800 12px/1.2 Arial, Helvetica, sans-serif !important",
      "gap: 6px !important",
      "grid-template-columns: auto minmax(70px, 1fr) auto !important"
    ].join("; ");

    const intervalPrefix = document.createElement("span");
    intervalPrefix.textContent = "Every";

    controlIntervalInput = document.createElement("input");
    controlIntervalInput.type = "number";
    controlIntervalInput.min = String(MIN_SCAN_INTERVAL_MS / 1000);
    controlIntervalInput.max = String(MAX_SCAN_INTERVAL_MS / 1000);
    controlIntervalInput.step = "0.25";
    controlIntervalInput.value = formatSeconds(scanIntervalMs);
    controlIntervalInput.style.cssText = [
      "appearance: textfield !important",
      "border: 1px solid #cbd5e1 !important",
      "border-radius: 6px !important",
      "box-sizing: border-box !important",
      "color: #0f172a !important",
      "font: 800 13px/1 Arial, Helvetica, sans-serif !important",
      "min-width: 0 !important",
      "padding: 7px 8px !important",
      "width: 100% !important"
    ].join("; ");
    controlIntervalInput.addEventListener("change", () => {
      setScanIntervalMs(Number(controlIntervalInput.value) * 1000);
    });
    controlIntervalInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    const intervalSuffix = document.createElement("span");
    intervalSuffix.textContent = "sec";

    controlStatus = document.createElement("span");
    controlStatus.className = "cat-autocatcher-control-status";
    controlStatus.style.cssText = [
      "grid-column: 1 / -1 !important",
      "color: #475569 !important",
      "display: block !important",
      "font: 700 12px/1.25 Arial, Helvetica, sans-serif !important"
    ].join("; ");

    controlButton = document.createElement("button");
    controlButton.type = "button";
    controlButton.style.cssText = [
      "grid-column: 1 / -1 !important",
      "width: 100% !important",
      "border: 0 !important",
      "border-radius: 7px !important",
      "background: #2563eb !important",
      "color: #ffffff !important",
      "cursor: pointer !important",
      "display: block !important",
      "font: 800 14px/1 Arial, Helvetica, sans-serif !important",
      "padding: 10px 12px !important",
      "text-align: center !important"
    ].join("; ");
    controlButton.addEventListener("click", handleControlButtonClick);

    controlResizeHandle = document.createElement("span");
    controlResizeHandle.title = "Drag to resize";
    controlResizeHandle.style.cssText = [
      "border-bottom: 3px solid #94a3b8 !important",
      "border-right: 3px solid #94a3b8 !important",
      "bottom: 5px !important",
      "cursor: se-resize !important",
      "height: 14px !important",
      "position: absolute !important",
      "right: 5px !important",
      "width: 14px !important"
    ].join("; ");
    controlResizeHandle.addEventListener("pointerdown", startControlResize);

    headerActions.append(controlCount, controlMinimizeButton, controlCloseButton);
    controlHeader.append(title, headerActions);
    controlIntervalLabel.append(intervalPrefix, controlIntervalInput, intervalSuffix);
    controlRoot.append(controlHeader, controlIntervalLabel, controlButton, controlStatus, controlResizeHandle);
    document.body.appendChild(controlRoot);
    applyControlGeometry();
    renderControl();
  }

  function renderControl() {
    createControl();

    if (!controlRoot || !controlButton || !controlStatus || !controlCount || !controlIntervalLabel || !controlResizeHandle || !controlHeader) {
      return;
    }

    controlRoot.style.setProperty("display", controlClosed ? "none" : "grid", "important");
    if (controlClosed) {
      return;
    }

    controlRoot.style.setProperty("gap", controlMinimized ? "0" : "8px", "important");
    controlRoot.style.setProperty("padding", controlMinimized ? "0" : "10px", "important");
    controlRoot.style.setProperty("border-radius", controlMinimized ? "7px" : "8px", "important");
    controlHeader.style.setProperty("display", controlMinimized ? "none" : "grid", "important");
    controlIntervalLabel.style.setProperty("display", controlMinimized ? "none" : "grid", "important");
    controlStatus.style.setProperty("display", controlMinimized ? "none" : "block", "important");
    controlResizeHandle.style.setProperty("display", controlMinimized ? "none" : "block", "important");

    controlCount.textContent = `${triggerCount} trigger${triggerCount === 1 ? "" : "s"}`;
    controlButton.textContent = isAutoCatching ? "Pause" : "Start";
    controlButton.title = controlMinimized ? "Click to start or pause. Double-click to expand." : "";
    controlButton.classList.toggle("is-running", isAutoCatching);
    controlButton.style.setProperty("background", isAutoCatching ? "#dc2626" : "#2563eb", "important");
    controlButton.style.setProperty("border-radius", "7px", "important");
    controlButton.style.setProperty("padding", controlMinimized ? "10px 0" : "10px 12px", "important");
    if (document.activeElement !== controlIntervalInput) {
      controlIntervalInput.value = formatSeconds(scanIntervalMs);
    }
    controlStatus.textContent = lastMessage;
    applyControlGeometry();
  }

  function scheduleScan() {
    try {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(() => {
        try {
          findTriggerElements();
          renderControl();
          if (isAutoCatching) {
            reportState();
          }
        } catch (error) {
          // Ignore scans during navigation teardown.
        }
      }, 150);
    } catch (error) {
      // Ignore scans during navigation teardown.
    }
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === "cat-autocatcher-scan-now" || message.type === "cat-autocatcher-get-state") {
      sendResponse(getState());
      return false;
    }

    if (message.type === "cat-autocatcher-start") {
      sendResponse(startAutoCatching());
      return false;
    }

    if (message.type === "cat-autocatcher-pause") {
      sendResponse(pauseAutoCatching());
      return false;
    }

    if (message.type === "cat-autocatcher-toggle") {
      sendResponse(isAutoCatching ? pauseAutoCatching() : startAutoCatching());
      return false;
    }

    return false;
  });

  const observer = new MutationObserver(scheduleScan);

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "class", "contenteditable", "role", "style", "title", "value"]
    });
  }

  window.addEventListener("pageshow", scheduleScan);
  window.addEventListener("focus", scheduleScan);
  window.addEventListener("cat-autocatcher-rescan", scheduleScan);
  createControl();
  scheduleScan();
})();
