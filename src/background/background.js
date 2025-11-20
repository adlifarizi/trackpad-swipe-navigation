/**
 * Background script for handling navigation commands
 * sent from content scripts (two-finger swipe gestures).
 *
 * Supports:
 *  - Back navigation
 *  - Forward navigation
 *
 * Fallback:
 *  If chrome.tabs.goBack() / goForward() fails (e.g. restricted sites),
 *  it injects history.back() / history.forward() into the active tab.
 */

/**
 * Executes fallback navigation inside the page using the History API.
 * @param {number} tabId
 * @param {"back" | "forward"} direction
 * @param {Function} sendResponse
 */
function fallbackNavigate(tabId, direction, sendResponse) {
    const fn = direction === "back"
        ? () => history.back()
        : () => history.forward();

    chrome.scripting.executeScript(
        { target: { tabId }, func: fn },
        () => sendResponse?.({ ok: true })
    );
}

/**
 * Tries native Chrome tab navigation, and falls back to in-page history.
 * @param {number} tabId
 * @param {"back" | "forward"} direction
 * @param {Function} sendResponse
 */
function handleNavigation(tabId, direction, sendResponse) {
    const api = direction === "back"
        ? chrome.tabs.goBack
        : chrome.tabs.goForward;

    api(tabId, () => {
        if (chrome.runtime.lastError) {
            // Native API failed → fallback inside the tab
            fallbackNavigate(tabId, direction, sendResponse);
        } else {
            sendResponse?.({ ok: true });
        }
    });
}

// Listen for messages sent by content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender?.tab || !msg?.action) return;

    const tabId = sender.tab.id;

    if (msg.action === "back") {
        handleNavigation(tabId, "back", sendResponse);
        return true; // keep channel open
    }

    if (msg.action === "forward") {
        handleNavigation(tabId, "forward", sendResponse);
        return true;
    }
});