export function switchToView(view) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    const btn = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (btn) btn.classList.add('active');
    document.getElementById(`view-${view}`)?.classList.add('active');
}

export function initNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchToView(btn.dataset.view);
        });
    });
}
