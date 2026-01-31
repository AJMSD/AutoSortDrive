interface StoredUser {
  name?: string;
  email?: string;
  picture?: string;
  accessToken?: string;
  expiresAt?: number;
}

const STORAGE_KEY = 'autosortdrive_user';

const readFromStorage = (storage: Storage): StoredUser | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
};

const writeToStorage = (storage: Storage, user: StoredUser) => {
  storage.setItem(STORAGE_KEY, JSON.stringify(user));
};

export const authStorage = {
  getStoredUser(): StoredUser | null {
    const sessionUser = readFromStorage(sessionStorage);
    if (sessionUser) return sessionUser;

    const localUser = readFromStorage(localStorage);
    if (localUser) {
      writeToStorage(sessionStorage, localUser);
      localStorage.removeItem(STORAGE_KEY);
      return localUser;
    }

    return null;
  },

  setStoredUser(user: StoredUser) {
    writeToStorage(sessionStorage, user);
    localStorage.removeItem(STORAGE_KEY);
  },

  clearStoredUser() {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  },

  getAccessToken(): string | null {
    return this.getStoredUser()?.accessToken || null;
  },

  getUserEmail(): string | null {
    return this.getStoredUser()?.email || null;
  },
};
