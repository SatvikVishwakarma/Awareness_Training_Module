import { motion } from 'framer-motion';

const sidebarVariants = {
  expanded: { x: 0 },
  collapsed: { x: 'calc(-100% + 52px)' }
};

export default function Sidebar({
  collapsed,
  modules,
  moduleAvailability,
  selectedModuleId,
  onSelectModule,
  onToggleSidebar
}) {
  return (
    <motion.aside
      className="sidebar"
      animate={collapsed ? 'collapsed' : 'expanded'}
      variants={sidebarVariants}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="sidebar-content">
        <header className="sidebar-header">
          <h1>Training Portal</h1>
          <p>Security and privacy modules</p>
        </header>

        <nav className="module-list" aria-label="Training modules">
          {modules.map((module) => {
            const enabled = moduleAvailability[module.id] !== false;
            const isActive = selectedModuleId === module.id;

            return (
              <button
                key={module.id}
                type="button"
                className={`module-button${isActive ? ' active' : ''}`}
                disabled={!enabled}
                onClick={() => onSelectModule(module.id)}
              >
                <span>{module.title}</span>
                <small>{enabled ? 'Available' : 'Disabled by admin'}</small>
              </button>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        className="sidebar-handle"
        onClick={onToggleSidebar}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </motion.aside>
  );
}
