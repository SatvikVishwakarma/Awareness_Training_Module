import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './components/Sidebar';
import { usePortalStore } from './store/usePortalStore';

export default function App() {
  const {
    modules,
    moduleAvailability,
    selectedModuleId,
    sidebarCollapsed,
    loading,
    error,
    siteLock,
    refreshPublicState,
    setSelectedModule,
    toggleSidebar
  } = usePortalStore();

  useEffect(() => {
    refreshPublicState();
  }, [refreshPublicState]);

  const activeModule = useMemo(
    () => modules.find((module) => module.id === selectedModuleId),
    [modules, selectedModuleId]
  );

  const isLocked = Boolean(siteLock?.locked);
  const moduleBaseUrl = window.location.port === '5173' ? 'http://localhost:3001' : '';

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        modules={modules}
        moduleAvailability={moduleAvailability}
        selectedModuleId={selectedModuleId}
        onSelectModule={setSelectedModule}
        onToggleSidebar={toggleSidebar}
      />

      <main className="content-area">
        <div className="topbar">
          <h2>{activeModule?.title || 'Training Portal'}</h2>
          <button type="button" onClick={refreshPublicState} className="refresh-button">
            Refresh State
          </button>
        </div>

        {loading && <p className="status-text">Loading portal state...</p>}
        {!loading && error && <p className="status-text error">{error}</p>}

        <AnimatePresence mode="wait">
          {!loading && !error && isLocked && (
            <motion.section
              key="locked"
              className="lock-card"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              <h3>Training Portal Locked</h3>
              <p>{siteLock?.reason || 'Training portal is temporarily unavailable.'}</p>
            </motion.section>
          )}

          {!loading && !error && !isLocked && activeModule && (
            <motion.section
              key={activeModule.id}
              className="module-frame-wrap"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              <iframe
                title={activeModule.title}
                src={`${moduleBaseUrl}/${activeModule.entryPath}`}
                className="module-frame"
              />
            </motion.section>
          )}

          {!loading && !error && !isLocked && !activeModule && (
            <motion.section
              key="empty"
              className="lock-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <h3>No module available</h3>
              <p>Ask an administrator to enable or register a training module.</p>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
