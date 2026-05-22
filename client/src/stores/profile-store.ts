import { defineStore } from 'pinia';
import type { PlayerProfile } from '../domain/profile';

interface ProfileState {
  profile: PlayerProfile | null;
}

export const useProfileStore = defineStore('profile', {
  state: (): ProfileState => ({
    profile: null
  }),
  actions: {
    setProfile(profile: PlayerProfile | null) {
      this.profile = profile;
    }
  }
});
