// Mock LocalStorage
const localStorageMock = (function() {
  let store = {};
  return {
    getItem: function(key) {
      return store[key] || null;
    },
    setItem: function(key, value) {
      store[key] = value.toString();
    },
    clear: function() {
      store = {};
    },
    removeItem: function(key) {
      delete store[key];
    }
  };
})();

global.localStorage = localStorageMock;

// Mock other browser globals if necessary

// Mock Document
global.document = {
    getElementById: () => null,
    activeElement: null
};

// Mock Supabase Client
global.window = {
    supabaseClient: {
        from: (table) => ({
            select: () => ({
                eq: () => ({
                    single: () => Promise.resolve({ data: {}, error: null }),
                    in: () => Promise.resolve({ data: [], error: null })
                }),
                in: () => Promise.resolve({ data: [], error: null })
            }),
            upsert: () => Promise.resolve({ error: null }),
            delete: () => ({ neq: () => Promise.resolve({ error: null }) })
        })
    },
    LAST_INTERACTION: Date.now(),
    addEventListener: () => {}
};

// Alias for direct usage in data.js
global.supabaseClient = global.window.supabaseClient;