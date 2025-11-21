/**
 * Popup script for Swipe Navigation extension.
 * Handles toggle state, invert option, and UI updates.
 */

const btn = document.getElementById("toggleBtn");
const toggleText = document.getElementById("toggleText");
const invertChk = document.getElementById("invertChk");

/**
 * Update the toggle button visual state.
 * @param {boolean} enabled 
 */
function updateToggleUI(enabled) {
    if (!btn || !toggleText) return;
    btn.classList.toggle("active", enabled);

    toggleText.textContent = enabled ? "Enabled" : "Disabled";
}

/**
 * Broadcast message to all tabs.
 * @param {object} msg 
 */
function broadcast(msg) {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id) chrome.tabs.sendMessage(tab.id, msg);
        }
    });
}

/* -----------------------------------------
   INITIAL LOAD
----------------------------------------- */

chrome.storage.sync.get(["enabled", "invert"], (res) => {
    const enabled = res.enabled ?? true;
    const invert = !!res.invert;

    updateToggleUI(enabled);

    if (invertChk) invertChk.checked = invert;
});

/* -----------------------------------------
   TOGGLE BUTTON CLICK
----------------------------------------- */

btn.addEventListener("click", () => {
    chrome.storage.sync.get(["enabled"], (res) => {
        const next = !(res.enabled ?? true);

        chrome.storage.sync.set({ enabled: next });
        updateToggleUI(next);

        // Notify all tabs
        broadcast({
            type: "toggle",
            enabled: next
        });
    });
});

/* -----------------------------------------
   INVERT CHECKBOX
----------------------------------------- */

if (invertChk) {
    invertChk.addEventListener("change", () => {
        const next = invertChk.checked;

        chrome.storage.sync.set({ invert: next });

        // Notify all tabs
        broadcast({
            type: "setInvert",
            invert: next
        });
    });
}

/* -----------------------------------------
   SLIDERS (SENSITIVITY & THRESHOLD)
----------------------------------------- */

const sensitivityRange = document.getElementById("sensitivityRange");
const sensitivityVal = document.getElementById("sensitivityVal");

const thresholdRange = document.getElementById("thresholdRange");
const thresholdVal = document.getElementById("thresholdVal");

// Load initial values
chrome.storage.sync.get(["sensitivity", "threshold"], (res) => {
    if (sensitivityRange) {
        const val = res.sensitivity ?? 10;
        sensitivityRange.value = val;
        sensitivityVal.textContent = val;
    }

    if (thresholdRange) {
        const val = res.threshold ?? 300;
        thresholdRange.value = val;
        thresholdVal.textContent = val + "px";
    }
});

// Sensitivity Listener
if (sensitivityRange) {
    sensitivityRange.addEventListener("input", () => {
        const val = parseInt(sensitivityRange.value, 10);
        sensitivityVal.textContent = val;
        chrome.storage.sync.set({ sensitivity: val });
        broadcast({ type: "setSensitivity", value: val });
    });
}

// Threshold Listener
if (thresholdRange) {
    thresholdRange.addEventListener("input", () => {
        const val = parseInt(thresholdRange.value, 10);
        thresholdVal.textContent = val + "px";
        chrome.storage.sync.set({ threshold: val });
        broadcast({ type: "setThreshold", value: val });
    });
}