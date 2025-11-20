/**
 * Swipe Navigation – Content Script
 * ---------------------------------
 * Detects two-finger horizontal swipe gestures using wheel events and sends
 * navigation actions ("back" / "forward") to background.js.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let enabled = true;
let cumulative = 0;
const threshold = 300;           // Required horizontal distance (px)
let gestureEndTimer = null;
const gestureEndDelay = 100;     // Time without wheel events → gesture ends

let gestureActive = false;
let primaryDirection = null;     // "back" or "forward"
let primarySign = 0;             // +1 or -1 from initial movement
let armed = false;

let invertDirection = false;

// Load initial inverted-direction state
if (chrome.storage?.sync) {
    chrome.storage.sync.get(["invert"], (res) => {
        invertDirection = !!res.invert;
    });
}


// ---------------------------------------------------------------------------
// Messages from popup (toggle, invert)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type) return;

    if (msg.type === "toggle") {
        enabled = msg.enabled;
    } else if (msg.type === "setInvert") {
        invertDirection = !!msg.invert;
    }
});


// ---------------------------------------------------------------------------
// Overlay (arrow indicator) SVG paths
// ---------------------------------------------------------------------------

const LEFT_SVG_PATH =
    "M48 256a208 208 0 1 1 416 0 208 208 0 1 1 -416 0zm464 0a256 256 0 1 0 -512 0 256 256 0 1 0 512 0zM124.7 244.7c-6.2 6.2-6.2 16.4 0 22.6l104 104c4.6 4.6 11.5 5.9 17.4 3.5s9.9-8.3 9.9-14.8l0-72 104 0c13.3 0 24-10.7 24-24l0-16c0-13.3-10.7-24-24-24l-104 0 0-72c0-6.5-3.9-12.3-9.9-14.8s-12.9-1.1-17.4 3.5l-104 104z";

const RIGHT_SVG_PATH =
    "M464 256a208 208 0 1 1 -416 0 208 208 0 1 1 416 0zM0 256a256 256 0 1 0 512 0 256 256 0 1 0 -512 0zm387.3 11.3c6.2-6.2 6.2-16.4 0-22.6l-104-104c-4.6-4.6-11.5-5.9-17.4-3.5S256 145.5 256 152l0 72-104 0c-13.3 0-24 10.7-24 24l0 16c0 13.3 10.7 24 24 24l104 0 0 72c0 6.5 3.9 12.3 9.9 14.8s12.9 1.1 17.4-3.5l104-104z";


// ---------------------------------------------------------------------------
// Overlay handling
// ---------------------------------------------------------------------------

let overlay = null;

/**
 * Create arrow overlay if it does not exist.
 */
function createOverlay() {
    if (overlay) return overlay;

    const container = document.createElement("div");
    container.id = "__swipe_nav_overlay";
    Object.assign(container.style, {
        position: "fixed",
        top: "50%",
        transform: "translateY(-50%)",
        width: "56px",
        height: "56px",
        pointerEvents: "none",
        zIndex: "2147483647",
        opacity: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity 120ms ease, transform 120ms ease"
    });

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.setAttribute("width", "48");
    svg.setAttribute("height", "48");
    svg.style.transition = "transform 120ms ease";

    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "black");
    svg.appendChild(path);
    container.appendChild(svg);

    document.documentElement.appendChild(container);

    overlay = { container, svg, path };
    return overlay;
}

/**
 * Update overlay position and style based on gesture progress.
 */
function updateOverlayProgress(direction, fraction) {
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const clamped = Math.max(0, Math.min(1, fraction));

    const edge = direction === "back" ? vw * 0.06 : vw * 0.94;
    const shift = 40 * clamped;
    const x = direction === "back" ? edge + shift : edge - shift;

    const o = createOverlay();
    o.container.style.left = `${x}px`;
    o.container.style.opacity = "1";
    o.path.setAttribute("d", direction === "back" ? LEFT_SVG_PATH : RIGHT_SVG_PATH);

    if (clamped >= 1) {
        o.svg.style.transform = "scale(1.12)";
        o.path.setAttribute("fill", "#0078d7");
        armed = true;
    } else {
        o.svg.style.transform = `scale(${0.95 + clamped * 0.1})`;
        o.path.setAttribute("fill", "black");
        armed = false;
    }
}

/**
 * Hide overlay without resetting state.
 */
function hideOverlay() {
    if (!overlay) return;
    overlay.container.style.opacity = "0";
    overlay.svg.style.transform = "scale(0.9)";
}

/**
 * Reset all gesture-related state.
 */
function resetGesture() {
    gestureActive = false;
    cumulative = 0;
    primaryDirection = null;
    primarySign = 0;
    armed = false;

    if (gestureEndTimer) {
        clearTimeout(gestureEndTimer);
        gestureEndTimer = null;
    }

    hideOverlay();
}


// ---------------------------------------------------------------------------
// Utility: Detect if element can scroll horizontally
// ---------------------------------------------------------------------------

function isRealHorizontalScrollContainer(el) {
    if (!el) return false;

    // Content bigger than container?
    const overflowing = el.scrollWidth > el.clientWidth;

    if (!overflowing) return false;

    //Test if we can scroll programmatically
    const prev = el.scrollLeft;
    el.scrollLeft += 1;
    const canScroll = el.scrollLeft !== prev;
    el.scrollLeft = prev;

    if (!canScroll) return false;

    // Check CSS overflow-x property
    const overflowX = getComputedStyle(el).overflowX;

    // overflow-x not hidden -> container can scroll horizontally
    if (overflowX !== "hidden") {
        return true;
    }

    // overflow-x hidden but canScroll true -> real container
    return true;
}

function shouldBlockSwipe(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
        if (isRealHorizontalScrollContainer(cur)) {
            return true; // block gesture swipe
        }
        cur = cur.parentElement;
    }
    return false; // allow swipe
}


// ---------------------------------------------------------------------------
// Gesture handling
// ---------------------------------------------------------------------------

window.addEventListener(
    "wheel",
    (e) => {
        if (!enabled) return;

        // Horizontal dominance check
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

        if (shouldBlockSwipe(e.target)) {
            // Detected real horizontal scroll container in path -> block gesture
            return;
        }

        // Begin gesture
        if (!gestureActive) {
            gestureActive = true;
            cumulative = 0;
            primarySign = 0;
            primaryDirection = null;
            armed = false;
        }

        cumulative += e.deltaX;

        // Determine initial direction once
        if (!primaryDirection && Math.abs(cumulative) > 6) {
            primarySign = Math.sign(cumulative) || 1;
            const mapped = primarySign > 0 ? "forward" : "back";

            primaryDirection = invertDirection
                ? mapped === "back" ? "forward" : "back"
                : mapped;
        }

        if (!primaryDirection) return;

        const signedProgress = cumulative * primarySign;

        if (signedProgress <= 0) {
            updateOverlayProgress(primaryDirection, 0);
            if (Math.abs(signedProgress) > threshold * 0.12) hideOverlay();
        } else {
            updateOverlayProgress(primaryDirection, Math.min(1, signedProgress / threshold));
        }

        // Wheel end detection timer
        if (gestureEndTimer) clearTimeout(gestureEndTimer);

        gestureEndTimer = setTimeout(() => {
            if (armed && primaryDirection) {
                chrome.runtime.sendMessage({ action: primaryDirection }, () => {
                    if (chrome.runtime.lastError) {
                        console.error("Navigation error:", chrome.runtime.lastError);
                    }
                    setTimeout(resetGesture, 120);
                });
            } else {
                resetGesture();
            }
        }, gestureEndDelay);
    },
    { passive: true }
);


// ---------------------------------------------------------------------------
// Emergency cleanup
// ---------------------------------------------------------------------------

document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetGesture();
});

window.addEventListener("beforeunload", () => {
    resetGesture();
});
