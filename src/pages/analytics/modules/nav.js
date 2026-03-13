/**
 * PMsToolKit — Analytics Hub
 * Sidebar navigation controller
 */

export function initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            document.getElementById(`view-${view}`)?.classList.add('active');
        });
    });
}
