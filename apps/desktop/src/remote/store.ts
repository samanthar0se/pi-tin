import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import type { ClientCommandInput, ExtensionUiRequest, ReviewStarted, ServerMessage } from "@pi-tin/protocol";
import { PiConnection, type HostProfile } from "./connection";
import { emptySession, reducePiEvent, replaceFromSnapshot, type SessionState } from "./reducer";

export type ActiveReview = { reviewId: string; kind: "plan" | "code"; url: string; visible: boolean; loading: boolean };

type LegacyHostProfile = HostProfile & { id?: string; name?: string };

type AppStore = {
  profile: HostProfile | null;
  connectionState: "connecting" | "connected" | "offline" | "error";
  connectionDetail?: string;
  session: SessionState;
  rpcStatus: "starting" | "ready" | "error" | "stopped";
  review: ActiveReview | null;
  extensionUiRequest: ExtensionUiRequest | null;
  lastError?: string;
  hydrateProfile: () => Promise<void>;
  saveProfile: (profile: HostProfile) => Promise<void>;
  clearProfile: () => Promise<void>;
  disconnect: () => void;
  command: (command: ClientCommandInput, timeoutMs?: number) => Promise<unknown>;
  respondToExtensionUi: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => Promise<void>;
  showReview: (visible: boolean) => void;
  reviewLoaded: () => void;
};

const PROFILE_KEY = "profile";
const LEGACY_PROFILES_KEY = "profiles";
const LEGACY_ACTIVE_KEY = "activeProfileId";

function normalizeProfile(value: LegacyHostProfile | null | undefined): HostProfile | null {
  if (!value?.host || !value.token) return null;
  return {
    host: value.host,
    controlPort: Number(value.controlPort || 31415),
    plannotatorPort: Number(value.plannotatorPort || 19432),
    token: value.token,
  };
}

async function writeProfile(profile: HostProfile | null): Promise<void> {
  try {
    const store = await load("profiles.json", { autoSave: true, defaults: {} });
    await store.set(PROFILE_KEY, profile);
    await store.delete(LEGACY_PROFILES_KEY);
    await store.delete(LEGACY_ACTIVE_KEY);
  } catch {
    localStorage.removeItem(LEGACY_PROFILES_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_KEY);
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  }
}

async function readProfile(): Promise<HostProfile | null> {
  try {
    const store = await load("profiles.json", { autoSave: true, defaults: {} });
    const current = normalizeProfile(await store.get<LegacyHostProfile>(PROFILE_KEY));
    if (current) return current;
    const profiles = (await store.get<LegacyHostProfile[]>(LEGACY_PROFILES_KEY)) || [];
    const activeId = await store.get<string>(LEGACY_ACTIVE_KEY);
    return normalizeProfile(profiles.find((profile) => profile.id === activeId) || profiles[0]);
  } catch {
    const current = normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"));
    if (current) return current;
    const profiles = JSON.parse(localStorage.getItem(LEGACY_PROFILES_KEY) || "[]") as LegacyHostProfile[];
    const activeId = localStorage.getItem(LEGACY_ACTIVE_KEY);
    return normalizeProfile(profiles.find((profile) => profile.id === activeId) || profiles[0]);
  }
}

function reviewUrl(profile: HostProfile | null, message: ReviewStarted): string {
  if (!profile) return message.url;
  try {
    const url = new URL(message.url);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) url.hostname = profile.host;
    url.port = String(profile.plannotatorPort);
    return url.toString();
  } catch {
    return `http://${profile.host}:${profile.plannotatorPort}`;
  }
}

let connection: PiConnection;

export const useAppStore = create<AppStore>((set, get) => {
  connection = new PiConnection({
    onState(connectionState, connectionDetail) { set({ connectionState, connectionDetail }); },
    onMessage(message: ServerMessage) {
      if (message.type === "snapshot") {
        set({ session: replaceFromSnapshot(message), lastError: undefined });
      } else if (message.type === "host_state") {
        set({ rpcStatus: message.rpcStatus, lastError: message.error });
      } else if (message.type === "event") {
        set((state) => ({
          session: reducePiEvent(state.session, message.event),
          ...(message.event.type === "agent_settled" ? { extensionUiRequest: null } : {}),
        }));
      } else if (message.type === "extension_ui_request") {
        if (["select", "confirm", "input", "editor"].includes(message.method)) set({ extensionUiRequest: message });
        else if (message.method === "notify" && message.notifyType === "error") set({ lastError: message.message });
      } else if (message.type === "review_started") {
        set({ review: { reviewId: message.reviewId, kind: message.kind, url: reviewUrl(get().profile, message), visible: true, loading: true } });
      } else if (message.type === "review_finished") {
        set((state) => state.review?.reviewId === message.reviewId
          ? { review: null, lastError: message.error }
          : { lastError: message.error });
      } else if (message.type === "error") {
        set({ lastError: message.message });
      }
    },
  });

  return {
    profile: null,
    connectionState: "offline",
    session: emptySession,
    rpcStatus: "stopped",
    review: null,
    extensionUiRequest: null,
    async hydrateProfile() {
      const profile = await readProfile();
      set({ profile });
      if (profile) connection.connect(profile);
    },
    async saveProfile(profile) {
      set({ profile, session: emptySession, review: null, extensionUiRequest: null, lastError: undefined });
      await writeProfile(profile);
      connection.connect(profile);
    },
    async clearProfile() {
      connection.disconnect();
      set({ profile: null, session: emptySession, review: null, extensionUiRequest: null, connectionState: "offline", connectionDetail: undefined });
      await writeProfile(null);
    },
    disconnect() {
      connection.disconnect();
      set({ connectionState: "offline", connectionDetail: undefined, review: null });
    },
    command(command, timeoutMs) { return connection.command(command, timeoutMs); },
    async respondToExtensionUi(response) {
      const request = get().extensionUiRequest;
      if (!request) return;
      await connection.command({ type: "extension_ui_response", uiRequestId: request.id, ...response });
      set((state) => state.extensionUiRequest?.id === request.id ? { extensionUiRequest: null } : {});
    },
    showReview(visible) { set((state) => ({ review: state.review ? { ...state.review, visible } : null })); },
    reviewLoaded() { set((state) => ({ review: state.review ? { ...state.review, loading: false } : null })); },
  };
});
