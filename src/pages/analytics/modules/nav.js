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

export function initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchToView(btn.dataset.view);
        });
    });
}
