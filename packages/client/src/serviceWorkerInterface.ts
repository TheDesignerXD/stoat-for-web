import { createSignal } from "solid-js";

import { registerSW } from "virtual:pwa-register";

const [pendingUpdate, setPendingUpdate] = createSignal<() => void>();

export { pendingUpdate };

/**
 * Convert a URL-safe base64 string to a Uint8Array.
 * Required for the applicationServerKey parameter in pushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribe the browser to push notifications and register
 * the subscription with the Revolt/Stoat backend.
 *
 * Flow:
 * 1. Check browser support for PushManager
 * 2. Request notification permission from the user
 * 3. Fetch the VAPID public key from the API root endpoint
 * 4. Subscribe via pushManager.subscribe() with the VAPID key
 * 5. POST the subscription (endpoint, p256dh, auth) to /push/subscribe
 */
async function subscribeToPush(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  try {
    // Check if push is supported
    if (!("PushManager" in window)) {
      console.info("[push] PushManager not supported in this browser");
      return;
    }

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.info("[push] Notification permission denied");
      return;
    }

    // Determine the API base URL
    // Check common environment variable names used by Revolt/Stoat
    const apiUrl =
      import.meta.env.VITE_API_URL ??
      import.meta.env.REVOLT_PUBLIC_URL ??
      `${window.location.origin}/api`;

    // Fetch VAPID public key from the API root endpoint
    const apiResponse = await fetch(apiUrl);
    if (!apiResponse.ok) {
      console.error("[push] Failed to fetch API config:", apiResponse.status);
      return;
    }

    const apiData = await apiResponse.json();
    const vapidPublicKey: string | undefined = apiData.vapid;

    if (!vapidPublicKey) {
      console.info("[push] No VAPID public key found in API response");
      return;
    }

    // Check for existing subscription to avoid duplicate registrations
    const existingSubscription =
      await registration.pushManager.getSubscription();
    if (existingSubscription) {
      console.info("[push] Already subscribed to push notifications");
      return;
    }

    // Subscribe the browser to push notifications
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    // Extract the p256dh and auth keys from the subscription
    const subscriptionJson = subscription.toJSON();
    const p256dh = subscriptionJson.keys?.p256dh;
    const auth = subscriptionJson.keys?.auth;

    if (!p256dh || !auth) {
      console.error("[push] Subscription missing required keys (p256dh/auth)");
      return;
    }

    // Retrieve the session token from localStorage
    // Revolt/Stoat stores it in different formats depending on version
    const rawSession =
      localStorage.getItem("revolt:session") ??
      localStorage.getItem("session");

    let token: string | null = null;
    if (rawSession) {
      try {
        const parsed = JSON.parse(rawSession);
        token =
          parsed.token ?? parsed.session_token ?? parsed.accessToken ?? null;
        if (typeof token !== "string") token = null;
      } catch {
        // Raw string token
        if (typeof rawSession === "string" && rawSession.length > 10) {
          token = rawSession;
        }
      }
    }

    if (!token) {
      console.info(
        "[push] No session token found, skipping push subscription",
      );
      return;
    }

    // Register the push subscription with the backend
    const response = await fetch(`${apiUrl}/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": token,
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh,
        auth,
      }),
    });

    if (response.ok) {
      console.info("[push] Subscription registered successfully");
    } else {
      console.error(
        "[push] Failed to register subscription:",
        response.status,
        await response.text(),
      );
    }
  } catch (err) {
    console.error("[push] Failed to subscribe to push notifications:", err);
  }
}

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    onNeedRefresh() {
      setPendingUpdate(() => void updateSW(true));
    },
    onOfflineReady() {
      console.info("Ready to work offline =)");
    },
    onRegistered(r) {
      // Check for updates every hour
      setInterval(() => r!.update(), 36e5);

      // Subscribe to push notifications after service worker registration
      if (r) {
        subscribeToPush(r);
      }
    },
  });
}
