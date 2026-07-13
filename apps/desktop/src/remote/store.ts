import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import type { ClientCommandInput, ReviewStarted, ServerMessage } from "@pi-remote/protocol";
import { PiConnection, type HostProfile } from "./connection";
import { emptySession, reducePiEvent, replaceFromSnapshot, type SessionState } from "./reducer";

export type ActiveReview = { reviewId: string; kind: "plan" | "code"; url: string; visible: boolean; loading: boolean };

type AppStore = {
  profiles: HostProfile[];
  activeProfileId: string | null;
  connectionState: "connecting" | "connected" | "offline" | "error";
  connectionDetail?: string;
  session: SessionState;
  review: ActiveReview | null;
  lastError?: string;
  hydrateProfiles: () => Promise<void>;
  saveProfile: (profile: HostProfile) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  activate: (id: string) => void;
  disconnect: () => void;
  command: (command: ClientCommandInput, timeoutMs?: number) => Promise<unknown>;
  showReview: (visible: boolean) => void;
  reviewLoaded: () => void;
};

const PROFILE_KEY = "profiles";
const ACTIVE_KEY = "activeProfileId";

async function writeProfiles(profiles: HostProfile[], activeProfileId: string | null): Promise<void> {
  try {
    const store = await load("profiles.json", { autoSave: true, defaults: {} });
    await store.set(PROFILE_KEY, profiles);
    await store.set(ACTIVE_KEY, activeProfileId);
  } catch {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
    localStorage.setItem(ACTIVE_KEY, activeProfileId || "");
  }
}

async function readProfiles(): Promise<{ profiles: HostProfile[]; activeProfileId: string | null }> {
  try {
    const store = await load("profiles.json", { autoSave: true, defaults: {} });
    return {
      profiles: (await store.get<HostProfile[]>(PROFILE_KEY)) || [],
      activeProfileId: (await store.get<string>(ACTIVE_KEY)) || null,
    };
  } catch {
    return {
      profiles: JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]"),
      activeProfileId: localStorage.getItem(ACTIVE_KEY) || null,
    };
  }
}

function reviewUrl(profile: HostProfile | undefined, message: ReviewStarted): string {
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
      } else if (message.type === "event") {
        set((state) => ({ session: reducePiEvent(state.session, message.event) }));
      } else if (message.type === "review_started") {
        const profile = get().profiles.find((item) => item.id === get().activeProfileId);
        set({ review: { reviewId: message.reviewId, kind: message.kind, url: reviewUrl(profile, message), visible: true, loading: true } });
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
    profiles: [], activeProfileId: null, connectionState: "offline", session: emptySession, review: null,
    async hydrateProfiles() {
      const data = await readProfiles();
      set(data);
      if (data.activeProfileId && data.profiles.some((profile) => profile.id === data.activeProfileId)) get().activate(data.activeProfileId);
    },
    async saveProfile(profile) {
      const profiles = [...get().profiles.filter((item) => item.id !== profile.id), profile];
      set({ profiles });
      await writeProfiles(profiles, get().activeProfileId);
    },
    async removeProfile(id) {
      const profiles = get().profiles.filter((item) => item.id !== id);
      let activeProfileId = get().activeProfileId;
      if (activeProfileId === id) {
        connection.disconnect();
        activeProfileId = null;
        set({ session: emptySession, review: null, connectionState: "offline" });
      }
      set({ profiles, activeProfileId });
      await writeProfiles(profiles, activeProfileId);
    },
    activate(id) {
      const profile = get().profiles.find((item) => item.id === id);
      if (!profile) return;
      set({ activeProfileId: id, session: emptySession, review: null, lastError: undefined });
      void writeProfiles(get().profiles, id);
      connection.connect(profile);
    },
    disconnect() {
      connection.disconnect();
      set({ connectionState: "offline", connectionDetail: undefined, session: emptySession, review: null });
    },
    command(command, timeoutMs) { return connection.command(command, timeoutMs); },
    showReview(visible) { set((state) => ({ review: state.review ? { ...state.review, visible } : null })); },
    reviewLoaded() { set((state) => ({ review: state.review ? { ...state.review, loading: false } : null })); },
  };
});
