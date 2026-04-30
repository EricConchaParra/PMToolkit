const SIDEBAR_COLLAPSED_CLASS = 'sidebar-collapsed';

function applySidebarCollapsed(collapsed) {
    document.body.classList.toggle(SIDEBAR_COLLAPSED_CLASS, collapsed);

    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const toggleIcon = toggleBtn?.querySelector('.sidebar-toggle-icon');
    const nextLabel = collapsed ? 'Expand menu' : 'Collapse menu';

    if (toggleBtn) {
        toggleBtn.setAttribute('aria-label', nextLabel);
        toggleBtn.setAttribute('aria-pressed', String(collapsed));
        toggleBtn.title = nextLabel;
    }

    if (toggleIcon) {
        toggleIcon.textContent = collapsed ? '›' : '‹';
    }
}

export function switchToView(view) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    const btn = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (btn) btn.classList.add('active');
    document.getElementById(`view-${view}`)?.classList.add('active');
    document.dispatchEvent(new CustomEvent('analytics:viewchange', { detail: { view } }));
}

export function getActiveView() {
    return document.querySelector('.nav-item.active')?.dataset.view || 'sprint-dashboard';
}

export function initNav({ sidebarCollapsed = false, onSidebarToggle = null } = {}) {
    applySidebarCollapsed(sidebarCollapsed);

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchToView(btn.dataset.view);
        });
    });

    document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
        const nextCollapsed = !document.body.classList.contains(SIDEBAR_COLLAPSED_CLASS);
        applySidebarCollapsed(nextCollapsed);
        if (typeof onSidebarToggle === 'function') void onSidebarToggle(nextCollapsed);
    });
}
