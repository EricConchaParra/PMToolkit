export function initTooltips() {
    let tooltipEl = document.getElementById('et-global-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'et-global-tooltip';
        tooltipEl.className = 'et-tooltip';
        document.body.appendChild(tooltipEl);
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            const text = target.getAttribute('data-tooltip');
            if (!text) return;

            tooltipEl.textContent = text;
            tooltipEl.classList.add('visible');

            const rect = target.getBoundingClientRect();
            let top = rect.top - tooltipEl.offsetHeight - 8;
            let left = rect.left + (rect.width / 2) - (tooltipEl.offsetWidth / 2);

            if (top < 0) {
                top = rect.bottom + 8;
            }
            if (left < 0) {
                left = 8;
            } else if (left + tooltipEl.offsetWidth > window.innerWidth) {
                left = window.innerWidth - tooltipEl.offsetWidth - 8;
            }

            tooltipEl.style.top = `${top + window.scrollY}px`;
            tooltipEl.style.left = `${left + window.scrollX}px`;
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            tooltipEl.classList.remove('visible');
        }
    });
}
