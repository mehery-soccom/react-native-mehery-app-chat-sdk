import { useSyncExternalStore } from 'react';
import { AppState, type ListViewToken, type NativeEventSubscription } from 'react-native';

/**
 * Which clip is playing, app-wide: one video or audio at a time. Starting one stops the other;
 * the app going to the background or the clip's message scrolling away stops it too.
 * Ids are `${messageKey}\n${url}`.
 */
let active: string | null = null;
const listeners = new Set<() => void>();
let appState: NativeEventSubscription | null = null;

function set(next: string | null) {
  if (next === active) return;
  active = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  appState ??= AppState.addEventListener('change', (s) => s !== 'active' && set(null));
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      appState?.remove();
      appState = null;
    }
  };
}

export const mediaId = (messageKey: string, url: string) => `${messageKey}\n${url}`;
export const play = (id: string) => set(id);
export const stop = (id: string) => {
  if (active === id) set(null);
};

/** True while this clip is the one playing. */
export function usePlaying(id: string): boolean {
  return useSyncExternalStore(subscribe, () => active === id, () => false);
}

/** For the message FlatList: stops playback when its message is scrolled out of view. */
export function pauseOffscreen({ viewableItems }: { viewableItems: ListViewToken[] }) {
  if (!active) return;
  const key = active.split('\n')[0];
  if (!viewableItems.some((v) => v.key === key)) set(null);
}
export const PLAYBACK_VIEWABILITY = { itemVisiblePercentThreshold: 15 };
