import { create } from 'zustand';
import { fetchPublicState } from '../api/portalApi';

function getInitialState() {
  return {
    modules: [],
    moduleAvailability: {},
    siteLock: null,
    selectedModuleId: '',
    sidebarCollapsed: false,
    loading: true,
    error: ''
  };
}

export const usePortalStore = create((set, get) => ({
  ...getInitialState(),

  setSidebarCollapsed(nextValue) {
    set({ sidebarCollapsed: Boolean(nextValue) });
  },

  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },

  setSelectedModule(moduleId) {
    set({ selectedModuleId: moduleId });
  },

  async refreshPublicState() {
    set({ loading: true, error: '' });

    try {
      const payload = await fetchPublicState();
      const modules = Array.isArray(payload.modules) ? payload.modules : [];
      const moduleAvailability = payload.moduleAvailability && typeof payload.moduleAvailability === 'object'
        ? payload.moduleAvailability
        : {};
      const enabledModules = modules.filter((module) => moduleAvailability[module.id] !== false);

      const currentSelected = get().selectedModuleId;
      const hasCurrent = enabledModules.some((module) => module.id === currentSelected);

      set({
        modules,
        moduleAvailability,
        siteLock: payload.siteLock || null,
        selectedModuleId: hasCurrent
          ? currentSelected
          : enabledModules[0]?.id || '',
        loading: false,
        error: ''
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load portal state'
      });
    }
  }
}));
