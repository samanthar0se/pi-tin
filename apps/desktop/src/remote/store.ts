import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import type {
  ClientCommandInput,
  ExtensionUiRequest,
  ReviewStarted,
  ServerMessage,
  SessionCommandInput,
  SessionDescriptor,
} from "@pi-tin/protocol";
import { PiConnection, type HostProfile } from "./connection";
import { nextEventAttention, type SessionAttention } from "./attention";
import { emptySession, reducePiEvent, replaceFromSnapshot, type SessionState } from "./reducer";
import { createEmptySessionDraft, type SessionDraft } from "../runtime/session-draft";

export type ActiveReview = { reviewId: string; kind: "plan" | "code"; url: string; visible: boolean; loading: boolean };
export type { SessionAttention } from "./attention";

type LegacyHostProfile = HostProfile & { id?: string; name?: string };
type RpcStatus = "starting" | "ready" | "error" | "stopped";
type SessionViewState = {
  session: SessionState;
  rpcStatus: RpcStatus;
  review: ActiveReview | null;
  extensionUiRequest: ExtensionUiRequest | null;
  attention: SessionAttention;
  draft: SessionDraft;
  lastError?: string;
};

type AppStore = {
  profile: HostProfile | null;
  connectionState: "connecting" | "connected" | "offline" | "error";
  connectionDetail?: string;
  sessions: SessionDescriptor[];
  sessionViews: Record<string, SessionViewState>;
  activeSessionId: string | null;
  maxSessions: number;
  session: SessionState;
  rpcStatus: RpcStatus;
  review: ActiveReview | null;
  extensionUiRequest: ExtensionUiRequest | null;
  lastError?: string;
  hydrateProfile: () => Promise<void>;
  saveProfile: (profile: HostProfile) => Promise<void>;
  clearProfile: () => Promise<void>;
  disconnect: () => void;
  setActiveSession: (sessionId: string) => void;
  createSession: (cwd: string) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  updateSessionDraft: (sessionId: string, update: (draft: SessionDraft) => SessionDraft) => void;
  command: (command: SessionCommandInput, timeoutMs?: number) => Promise<unknown>;
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

function emptyView(descriptor?: SessionDescriptor): SessionViewState {
  return {
    session: {
      ...emptySession,
      cwd: descriptor?.cwd || "",
      sessionFile: descriptor?.sessionFile || null,
      sessionName: descriptor?.sessionName || null,
      isRunning: descriptor?.isRunning || false,
    },
    rpcStatus: descriptor?.rpcStatus || "stopped",
    review: null,
    extensionUiRequest: null,
    attention: null,
    draft: createEmptySessionDraft(),
  };
}

function activeProjection(sessionViews: Record<string, SessionViewState>, activeSessionId: string | null) {
  const view = activeSessionId ? sessionViews[activeSessionId] : undefined;
  return view ? {
    session: view.session,
    rpcStatus: view.rpcStatus,
    review: view.review,
    extensionUiRequest: view.extensionUiRequest,
    lastError: view.lastError,
  } : {
    session: { ...emptySession },
    rpcStatus: "stopped" as const,
    review: null,
    extensionUiRequest: null,
    lastError: undefined,
  };
}

function updateDescriptor(sessions: SessionDescriptor[], sessionId: string, update: Partial<SessionDescriptor>): SessionDescriptor[] {
  return sessions.map((session) => session.sessionId === sessionId ? { ...session, ...update } : session);
}

let connection: PiConnection;

export const useAppStore = create<AppStore>((set, get) => {
  connection = new PiConnection({
    onState(connectionState, connectionDetail) { set({ connectionState, connectionDetail }); },
    onMessage(message: ServerMessage) {
      if (message.type === "session_list") {
        set((state) => {
          const sessionViews: Record<string, SessionViewState> = {};
          for (const descriptor of message.sessions) {
            const previous = state.sessionViews[descriptor.sessionId];
            sessionViews[descriptor.sessionId] = previous ? {
              ...previous,
              rpcStatus: descriptor.rpcStatus,
              session: {
                ...previous.session,
                cwd: descriptor.cwd,
                sessionFile: descriptor.sessionFile,
                sessionName: descriptor.sessionName,
                isRunning: descriptor.isRunning,
              },
            } : emptyView(descriptor);
          }
          let activeSessionId = state.activeSessionId && sessionViews[state.activeSessionId]
            ? state.activeSessionId
            : null;
          if (!activeSessionId && message.sessions.length > 0) {
            const previousIndex = state.sessions.findIndex((session) => session.sessionId === state.activeSessionId);
            activeSessionId = message.sessions[Math.min(Math.max(previousIndex, 0), message.sessions.length - 1)].sessionId;
          }
          if (activeSessionId !== state.activeSessionId && activeSessionId) {
            sessionViews[activeSessionId] = { ...sessionViews[activeSessionId], attention: null };
          }
          return {
            sessions: message.sessions,
            sessionViews,
            activeSessionId,
            maxSessions: message.maxSessions,
            ...activeProjection(sessionViews, activeSessionId),
          };
        });
      } else if (message.type === "snapshot") {
        set((state) => {
          const previous = state.sessionViews[message.sessionId] || emptyView();
          const sessionViews = {
            ...state.sessionViews,
            [message.sessionId]: { ...previous, session: replaceFromSnapshot(message), lastError: undefined },
          };
          const sessions = updateDescriptor(state.sessions, message.sessionId, {
            cwd: message.cwd,
            sessionFile: message.sessionFile,
            sessionName: message.sessionName,
            isRunning: message.isRunning,
          });
          return {
            sessions,
            sessionViews,
            ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
          };
        });
      } else if (message.type === "host_state") {
        set((state) => {
          const previous = state.sessionViews[message.sessionId] || emptyView();
          const attention = state.activeSessionId === message.sessionId
            ? null
            : message.rpcStatus === "error" ? "failed" : previous.attention;
          const sessionViews = {
            ...state.sessionViews,
            [message.sessionId]: { ...previous, rpcStatus: message.rpcStatus, attention, lastError: message.error },
          };
          const sessions = updateDescriptor(state.sessions, message.sessionId, {
            rpcStatus: message.rpcStatus,
            activeReviewId: message.activeReviewId ?? null,
          });
          return {
            sessions,
            sessionViews,
            ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
          };
        });
      } else if (message.type === "event") {
        set((state) => {
          const previous = state.sessionViews[message.sessionId] || emptyView();
          const session = reducePiEvent(previous.session, message.event);
          const event = message.event as { type?: string; message?: { stopReason?: string }; isError?: boolean };
          const isActive = state.activeSessionId === message.sessionId;
          const attention = nextEventAttention({
            previous: previous.attention,
            isActive,
            wasRunning: previous.session.isRunning,
            isRunning: session.isRunning,
            event,
          });
          const sessionViews = {
            ...state.sessionViews,
            [message.sessionId]: {
              ...previous,
              session,
              attention,
              ...(message.event.type === "agent_settled" ? { extensionUiRequest: null } : {}),
            },
          };
          const sessions = updateDescriptor(state.sessions, message.sessionId, { isRunning: session.isRunning });
          return {
            sessions,
            sessionViews,
            ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
          };
        });
      } else if (message.type === "extension_ui_request") {
        if (["select", "confirm", "input", "editor"].includes(message.method)) {
          set((state) => {
            const previous = state.sessionViews[message.sessionId] || emptyView();
            const sessionViews = {
              ...state.sessionViews,
              [message.sessionId]: {
                ...previous,
                extensionUiRequest: message,
                attention: state.activeSessionId === message.sessionId ? null : "needs-input" as const,
              },
            };
            return {
              sessionViews,
              ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
            };
          });
        } else if (message.method === "notify" && message.notifyType === "error") {
          set((state) => {
            const previous = state.sessionViews[message.sessionId] || emptyView();
            const sessionViews = {
              ...state.sessionViews,
              [message.sessionId]: {
                ...previous,
                attention: state.activeSessionId === message.sessionId ? null : "failed" as const,
                lastError: message.message,
              },
            };
            return {
              sessionViews,
              ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
            };
          });
        }
      } else if (message.type === "review_started") {
        set((state) => {
          const previous = state.sessionViews[message.sessionId] || emptyView();
          const sessionViews = {
            ...state.sessionViews,
            [message.sessionId]: {
              ...previous,
              review: { reviewId: message.reviewId, kind: message.kind, url: reviewUrl(get().profile, message), visible: true, loading: true },
              attention: state.activeSessionId === message.sessionId ? null : "review" as const,
            },
          };
          return {
            sessionViews,
            sessions: updateDescriptor(state.sessions, message.sessionId, { activeReviewId: message.reviewId }),
            ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
          };
        });
      } else if (message.type === "review_finished") {
        set((state) => {
          const previous = state.sessionViews[message.sessionId] || emptyView();
          const attention: SessionAttention = state.activeSessionId === message.sessionId ? null : message.error ? "failed" : "completed";
          const sessionViews = {
            ...state.sessionViews,
            [message.sessionId]: {
              ...previous,
              review: previous.review?.reviewId === message.reviewId ? null : previous.review,
              attention,
              lastError: message.error,
            },
          };
          return {
            sessionViews,
            sessions: updateDescriptor(state.sessions, message.sessionId, { activeReviewId: null }),
            ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
          };
        });
      } else if (message.type === "error") {
        if (message.sessionId) {
          set((state) => {
            const previous = state.sessionViews[message.sessionId!] || emptyView();
            const sessionViews = {
              ...state.sessionViews,
              [message.sessionId!]: {
                ...previous,
                attention: state.activeSessionId === message.sessionId ? null : "failed" as const,
                lastError: message.message,
              },
            };
            return {
              sessionViews,
              ...(state.activeSessionId === message.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
            };
          });
        } else {
          set({ lastError: message.message });
        }
      }
    },
  });

  return {
    profile: null,
    connectionState: "offline",
    sessions: [],
    sessionViews: {},
    activeSessionId: null,
    maxSessions: 5,
    session: { ...emptySession },
    rpcStatus: "stopped",
    review: null,
    extensionUiRequest: null,
    async hydrateProfile() {
      const profile = await readProfile();
      set({ profile });
      if (profile) connection.connect(profile);
    },
    async saveProfile(profile) {
      set({
        profile,
        sessions: [],
        sessionViews: {},
        activeSessionId: null,
        session: { ...emptySession },
        rpcStatus: "stopped",
        review: null,
        extensionUiRequest: null,
        lastError: undefined,
      });
      await writeProfile(profile);
      connection.connect(profile);
    },
    async clearProfile() {
      connection.disconnect();
      set({
        profile: null,
        sessions: [],
        sessionViews: {},
        activeSessionId: null,
        session: { ...emptySession },
        rpcStatus: "stopped",
        review: null,
        extensionUiRequest: null,
        connectionState: "offline",
        connectionDetail: undefined,
      });
      await writeProfile(null);
    },
    disconnect() {
      connection.disconnect();
      set({ connectionState: "offline", connectionDetail: undefined, review: null });
    },
    setActiveSession(activeSessionId) {
      set((state) => {
        const previous = state.sessionViews[activeSessionId];
        if (!previous) return {};
        const sessionViews = {
          ...state.sessionViews,
          [activeSessionId]: { ...previous, attention: null },
        };
        return { sessionViews, activeSessionId, ...activeProjection(sessionViews, activeSessionId) };
      });
    },
    async createSession(cwd) {
      const result = await connection.command({ type: "create_session", cwd }, 30_000) as { sessionId: string };
      get().setActiveSession(result.sessionId);
      return result.sessionId;
    },
    async closeSession(sessionId) {
      await connection.command({ type: "close_session", sessionId }, 30_000);
    },
    updateSessionDraft(sessionId, update) {
      set((state) => {
        const previous = state.sessionViews[sessionId];
        if (!previous) return {};
        const draft = update(previous.draft);
        if (draft === previous.draft) return {};
        return {
          sessionViews: {
            ...state.sessionViews,
            [sessionId]: { ...previous, draft },
          },
        };
      });
    },
    command(command, timeoutMs) {
      const sessionId = get().activeSessionId;
      if (!sessionId) return Promise.reject(new Error("Open a Pi session before sending a command."));
      return connection.command({ ...command, sessionId } as ClientCommandInput, timeoutMs);
    },
    async respondToExtensionUi(response) {
      const request = get().extensionUiRequest;
      if (!request) return;
      await connection.command({ type: "extension_ui_response", sessionId: request.sessionId, uiRequestId: request.id, ...response });
      set((state) => {
        const previous = state.sessionViews[request.sessionId];
        if (!previous || previous.extensionUiRequest?.id !== request.id) return {};
        const sessionViews = {
          ...state.sessionViews,
          [request.sessionId]: { ...previous, extensionUiRequest: null, attention: null },
        };
        return {
          sessionViews,
          ...(state.activeSessionId === request.sessionId ? activeProjection(sessionViews, state.activeSessionId) : {}),
        };
      });
    },
    showReview(visible) {
      set((state) => {
        const sessionId = state.activeSessionId;
        if (!sessionId) return {};
        const previous = state.sessionViews[sessionId];
        if (!previous?.review) return {};
        const sessionViews = {
          ...state.sessionViews,
          [sessionId]: { ...previous, review: { ...previous.review, visible } },
        };
        return { sessionViews, ...activeProjection(sessionViews, sessionId) };
      });
    },
    reviewLoaded() {
      set((state) => {
        const sessionId = state.activeSessionId;
        if (!sessionId) return {};
        const previous = state.sessionViews[sessionId];
        if (!previous?.review) return {};
        const sessionViews = {
          ...state.sessionViews,
          [sessionId]: { ...previous, review: { ...previous.review, loading: false } },
        };
        return { sessionViews, ...activeProjection(sessionViews, sessionId) };
      });
    },
  };
});
