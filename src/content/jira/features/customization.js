import { storage } from '../../../common/storage';

export const CustomizationFeature = {
    hideHeaderElements() {
        const selectors = [
            '[data-testid="search-input-container"]',
            '[data-testid="atlassian-navigation--create-button"]',
            'button[aria-label*="Ask Rovo"]'
        ];
        selectors.forEach(s => {
            const el = document.querySelector(s);
            if (el) el.style.display = 'none';
        });
    },

    collapseSidebar() {
        if (window._etSidebarCollapsed) return;
        const sidebar = document.querySelector('[data-testid="page-layout.sidebar"]');
        if (sidebar && sidebar.offsetWidth > 100) {
            const collapseBtn = Array.from(document.querySelectorAll('button')).find(btn =>
                btn.getAttribute('aria-label')?.includes('Collapse sidebar')
            );
            if (collapseBtn) {
                collapseBtn.click();
                window._etSidebarCollapsed = true;
            }
        }
    }
};
